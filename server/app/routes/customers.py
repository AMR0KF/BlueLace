"""Customers and payment collections (Auto oldest-first / Per-order), collection
cancellation, store-credit application. Ports collectPayment + paymentBaseId grouping
(local-db-server.mjs:1161, 3503) — collections are cash-only; a collection spanning
N orders is N payment rows sharing '<groupId>:<n>' ids.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import audit_log, db
from .._sale_math import apply_settlement
from ..auth import require_user
from ..bootstrap import build_bootstrap
from ..config import MONEY_EPSILON
from ..money import round_base_money
from ..schemas import CollectBody, CustomerBody
from ..settings import get_settings

router = APIRouter()


def _get_customer(conn, customer_id: str) -> dict:
    customer = db.one(conn, "SELECT * FROM customers WHERE id = ?", (customer_id,))
    if customer is None:
        raise HTTPException(404, "Customer not found.")
    return customer


@router.post("/api/customers")
def create_customer(body: CustomerBody, user=Depends(require_user("cashier"))):
    with db.tx() as conn:
        customer_id = db.new_id("cus")
        conn.execute(
            """INSERT INTO customers (id, name, phone, note, credit_limit, store_credit,
               is_system, created_at) VALUES (?,?,?,?,?,0,0,?)""",
            (customer_id, body.name.strip(), body.phone, body.note,
             round_base_money(body.creditLimit), db.now_iso()),
        )
        audit_log.log(conn, user["id"], "customer.create", "customer", customer_id,
                      {"name": body.name})
        return build_bootstrap(conn, user)


@router.patch("/api/customers/{customer_id}")
def update_customer(customer_id: str, body: CustomerBody, user=Depends(require_user("cashier"))):
    with db.tx() as conn:
        customer = _get_customer(conn, customer_id)
        if customer["isSystem"]:
            raise HTTPException(400, "The walk-in customer can't be edited.")
        conn.execute(
            "UPDATE customers SET name = ?, phone = ?, note = ?, credit_limit = ? WHERE id = ?",
            (body.name.strip(), body.phone, body.note,
             round_base_money(body.creditLimit), customer_id),
        )
        audit_log.log(conn, user["id"], "customer.update", "customer", customer_id,
                      {"name": body.name})
        return build_bootstrap(conn, user)


@router.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: str, user=Depends(require_user("admin"))):
    with db.tx() as conn:
        customer = _get_customer(conn, customer_id)
        if customer["isSystem"]:
            raise HTTPException(400, "The walk-in customer can't be deleted.")
        open_due = conn.execute(
            """SELECT COALESCE(SUM(due_amount), 0) AS due FROM sales
               WHERE customer_id = ? AND status IN ('partial','unpaid')""",
            (customer_id,)).fetchone()["due"]
        if open_due > MONEY_EPSILON:
            raise HTTPException(400, "This customer still owes money — collect or void first.")
        has_history = conn.execute(
            "SELECT 1 FROM sales WHERE customer_id = ? LIMIT 1", (customer_id,)).fetchone()
        if has_history:
            raise HTTPException(
                400, "This customer has order history and can't be deleted.")
        conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
        audit_log.log(conn, user["id"], "customer.delete", "customer", customer_id,
                      {"name": customer["name"]})
        return build_bootstrap(conn, user)


@router.post("/api/payments/collect")
def collect_payment(body: CollectBody, user=Depends(require_user("cashier"))):
    with db.tx() as conn:
        customer = _get_customer(conn, body.customerId)
        settings = get_settings(conn)
        tender_currency = body.tenderCurrency.strip().upper()
        if tender_currency not in (settings["baseCurrency"], settings["secondaryCurrency"]):
            raise HTTPException(400, "Unknown tender currency.")
        tender_rate = body.tenderRate or settings["exchangeRate"]

        open_sales = db.rows(
            conn,
            """SELECT * FROM sales WHERE customer_id = ? AND status IN ('partial','unpaid')
               AND due_amount > ? ORDER BY created_at ASC""",
            (body.customerId, MONEY_EPSILON),
        )
        if not open_sales:
            raise HTTPException(400, "This customer has no open orders.")
        total_open = round_base_money(sum(s["dueAmount"] for s in open_sales))

        cash_amount = round_base_money(body.amount)
        credit_amount = 0.0
        if body.useStoreCredit and customer["storeCredit"] > MONEY_EPSILON:
            credit_amount = round_base_money(
                min(customer["storeCredit"], total_open - min(cash_amount, total_open)))

        if cash_amount + credit_amount <= MONEY_EPSILON:
            raise HTTPException(400, "Nothing to collect.")
        if cash_amount > total_open + MONEY_EPSILON:
            raise HTTPException(400, "That's more than the customer owes.")

        group_id = db.new_id("pay")
        now = db.now_iso()
        seq = 0

        def add_row(sale: dict, amount: float, kind: str) -> None:
            nonlocal seq
            seq += 1
            conn.execute(
                """INSERT INTO payments (id, customer_id, sale_id, amount, method, kind,
                   notes, tender_currency, tender_rate, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (f"{group_id}:{seq}", body.customerId, sale["id"], amount,
                 "store_credit" if kind == "store_credit_use" else "cash", kind,
                 body.notes, tender_currency if kind == "collection" else None,
                 tender_rate if kind == "collection" else None, user["id"], now),
            )
            sale["dueAmount"] = round_base_money(sale["dueAmount"] - amount)
            sale["paidAmount"] = round_base_money(sale["paidAmount"] + amount)
            apply_settlement(conn, sale["id"], paid=sale["paidAmount"], due=sale["dueAmount"])

        if body.mode == "per_order":
            if not body.allocations:
                raise HTTPException(400, "Per-order mode needs allocations.")
            by_id = {s["id"]: s for s in open_sales}
            allocated = 0.0
            for alloc in body.allocations:
                sale = by_id.get(alloc.saleId)
                if sale is None:
                    raise HTTPException(400, "An allocation references an order that isn't open.")
                amount = round_base_money(alloc.amount)
                if amount > sale["dueAmount"] + MONEY_EPSILON:
                    raise HTTPException(
                        400, f"Allocation for {sale['id']} exceeds its due amount.")
                add_row(sale, min(amount, sale["dueAmount"]), "collection")
                allocated = round_base_money(allocated + amount)
            if abs(allocated - cash_amount) >= MONEY_EPSILON:
                raise HTTPException(400, "Allocations must add up to the amount collected.")
        else:
            # Auto: store credit first (if requested), then cash — both oldest-first.
            remaining_credit = credit_amount
            for sale in open_sales:
                if remaining_credit <= MONEY_EPSILON:
                    break
                pay = round_base_money(min(sale["dueAmount"], remaining_credit))
                if pay <= MONEY_EPSILON:
                    continue
                add_row(sale, pay, "store_credit_use")
                remaining_credit = round_base_money(remaining_credit - pay)
            remaining_cash = cash_amount
            for sale in open_sales:
                if remaining_cash <= MONEY_EPSILON:
                    break
                if sale["dueAmount"] <= MONEY_EPSILON:
                    continue
                pay = round_base_money(min(sale["dueAmount"], remaining_cash))
                add_row(sale, pay, "collection")
                remaining_cash = round_base_money(remaining_cash - pay)
            if remaining_cash > MONEY_EPSILON:
                raise HTTPException(400, "That's more than the customer owes.")

        if credit_amount > MONEY_EPSILON:
            conn.execute("UPDATE customers SET store_credit = store_credit - ? WHERE id = ?",
                         (credit_amount, body.customerId))

        audit_log.log(conn, user["id"], "payment.collect", "customer", body.customerId,
                      {"groupId": group_id, "cash": cash_amount, "storeCredit": credit_amount,
                       "mode": body.mode, "tender": tender_currency})
        return build_bootstrap(conn, user)


@router.post("/api/payments/{group_id}/cancel")
def cancel_collection(group_id: str, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        rows = db.rows(
            conn, "SELECT * FROM payments WHERE id = ? OR id LIKE ? ORDER BY id",
            (group_id, f"{group_id}:%"),
        )
        if not rows:
            raise HTTPException(404, "Collection not found.")
        credit_back = 0.0
        for row in rows:
            sale = db.one(conn, "SELECT * FROM sales WHERE id = ?", (row["saleId"],))
            if sale is None:
                continue
            apply_settlement(conn, sale["id"],
                             paid=sale["paidAmount"] - row["amount"],
                             due=sale["dueAmount"] + row["amount"])
            if row["kind"] == "store_credit_use":
                credit_back = round_base_money(credit_back + row["amount"])
            conn.execute("DELETE FROM payments WHERE id = ?", (row["id"],))
        if credit_back > 0 and rows[0]["customerId"]:
            conn.execute("UPDATE customers SET store_credit = store_credit + ? WHERE id = ?",
                         (credit_back, rows[0]["customerId"]))
        audit_log.log(conn, user["id"], "payment.cancel", "payment", group_id,
                      {"rows": len(rows), "creditReturned": credit_back})
        return build_bootstrap(conn, user)
