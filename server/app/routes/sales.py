"""Sales: create (offline-replay idempotent), edit lines/customer/discount,
reset-upfront, void, delete-voided, returns and return cancellation.

Ports the original's server-side sale logic (local-db-server.mjs createSale/voidSale/
createReturn, sale-edit math at 3190-3295) to the shoe domain.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import audit_log, db
from .._sale_math import (apply_settlement, compute_totals, effective_tax_rate,
                          enforce_discount_reason, status_for)
from ..auth import require_user
from ..bootstrap import build_bootstrap
from ..config import MONEY_EPSILON
from ..money import money_eq, round_base_money
from ..schemas import (ReturnBody, SaleBody, SaleCustomerPatchBody,
                       SaleDiscountPatchBody, SaleLinesPatchBody, VoidBody)
from ..settings import get_settings

router = APIRouter()


def _get_sale(conn, sale_id: str) -> dict:
    sale = db.one(conn, "SELECT * FROM sales WHERE id = ?", (sale_id,))
    if sale is None:
        raise HTTPException(404, "Order not found.")
    return sale


def _sale_lines(conn, sale_id: str) -> list[dict]:
    return db.rows(conn, "SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,))


def _has_payments(conn, sale_id: str) -> bool:
    return conn.execute("SELECT 1 FROM payments WHERE sale_id = ? LIMIT 1",
                        (sale_id,)).fetchone() is not None


def _has_returns(conn, sale_id: str) -> bool:
    return conn.execute("SELECT 1 FROM sale_returns WHERE sale_id = ? LIMIT 1",
                        (sale_id,)).fetchone() is not None


def _resolve_customer(conn, customer_id: str | None) -> dict | None:
    if not customer_id:
        return None
    customer = db.one(conn, "SELECT * FROM customers WHERE id = ?", (customer_id,))
    if customer is None:
        raise HTTPException(400, "Customer not found.")
    return customer


def _guard_not_voided(sale: dict) -> None:
    if sale["status"] == "voided":
        raise HTTPException(400, "This order is voided.")


@router.post("/api/sales")
def create_sale(body: SaleBody, user=Depends(require_user("cashier"))):
    with db.tx() as conn:
        # Offline replay idempotency: same client id replayed twice is a no-op.
        if body.id and db.one(conn, "SELECT id FROM sales WHERE id = ?", (body.id,)):
            return build_bootstrap(conn, user)

        settings = get_settings(conn)
        tender_currency = body.tenderCurrency.strip().upper()
        if tender_currency not in (settings["baseCurrency"], settings["secondaryCurrency"]):
            raise HTTPException(400, "Unknown tender currency.")
        # Honor the client's frozen rate (offline replay); fall back to current settings.
        tender_rate = body.tenderRate or settings["exchangeRate"]
        if tender_rate <= 0:
            raise HTTPException(400, "Exchange rate must be set before selling.")

        customer = _resolve_customer(conn, body.customerId)

        # Build lines with frozen labels and frozen unit cost.
        prepared = []
        for line in body.lines:
            unit_price = round_base_money(line.unitPrice)
            if line.variantId:
                row = db.one(
                    conn,
                    """SELECT v.*, m.name AS model_name, m.brand, m.default_cost
                       FROM shoe_variants v JOIN shoe_models m ON m.id = v.model_id
                       WHERE v.id = ?""",
                    (line.variantId,),
                )
                if row is None:
                    raise HTTPException(400, "A cart line references a missing variant.")
                unit_cost = row["lastCost"] if row["lastCost"] is not None else row["defaultCost"]
                prepared.append({
                    "variantId": line.variantId, "modelName": row["modelName"],
                    "brand": row["brand"], "color": row["color"], "size": row["size"],
                    "sku": row["sku"], "qty": line.qty, "unitPrice": unit_price,
                    "unitCost": round_base_money(unit_cost or 0),
                    "prevStock": row["stockQty"],
                })
            else:
                name = (line.customName or "").strip()
                if not name:
                    raise HTTPException(400, "Custom lines need a name.")
                prepared.append({
                    "variantId": None, "modelName": name, "brand": None, "color": None,
                    "size": None, "sku": None, "qty": line.qty, "unitPrice": unit_price,
                    "unitCost": 0.0, "prevStock": None,
                })

        line_totals = [round_base_money(p["qty"] * p["unitPrice"]) for p in prepared]
        totals = compute_totals(line_totals, body.discountAmount, settings["taxRate"])
        discount_reason = enforce_discount_reason(
            totals["discount"], totals["subtotal"], body.discountReason)

        # Settlement.
        if body.paymentMode == "cash":
            paid, due = totals["total"], 0.0
        else:
            paid = round_base_money(min(body.paidNow, totals["total"]))
            if paid >= totals["total"] - MONEY_EPSILON and totals["total"] > 0:
                raise HTTPException(400, "Partial payment must be less than the total — use Cash.")
            due = round_base_money(totals["total"] - paid)
            if due > MONEY_EPSILON:
                if customer is None:
                    raise HTTPException(400, "Unpaid or partial orders need a customer.")
                if customer["isSystem"]:
                    raise HTTPException(400, "The walk-in customer can't hold debt — pick a real customer.")

        sale_id = body.id or db.new_id("S")
        created_at = body.createdAt or db.now_iso()
        order_no = (conn.execute("SELECT COALESCE(MAX(order_no), 0) FROM sales").fetchone()[0]) + 1
        items_count = sum(p["qty"] for p in prepared)

        conn.execute(
            """INSERT INTO sales (id, order_no, customer_id, status, subtotal,
               discount_amount, discount_reason, tax_amount, total, upfront_paid,
               paid_amount, due_amount, items_count, tender_currency, tender_rate,
               user_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (sale_id, order_no, body.customerId, status_for(paid, due),
             totals["subtotal"], totals["discount"], discount_reason, totals["tax"],
             totals["total"], paid, paid, due, items_count, tender_currency,
             tender_rate, user["id"], created_at),
        )

        for p, line_total in zip(prepared, line_totals):
            conn.execute(
                """INSERT INTO sale_items (id, sale_id, variant_id, model_name, brand,
                   color, size, sku, qty, unit_price, unit_cost, line_total)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (db.new_id("li"), sale_id, p["variantId"], p["modelName"], p["brand"],
                 p["color"], p["size"], p["sku"], p["qty"], p["unitPrice"],
                 p["unitCost"], line_total),
            )
            if p["variantId"]:
                # Oversell is allowed (the shoe is physically in hand) but flagged for review.
                needs_review = 1 if p["prevStock"] < p["qty"] else 0
                conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty - ? WHERE id = ?",
                             (p["qty"], p["variantId"]))
                conn.execute(
                    """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                       unit_cost, ref_sale_id, needs_review, user_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (db.new_id("mov"), p["variantId"], "sale", -p["qty"], p["unitCost"],
                     sale_id, needs_review, user["id"], created_at),
                )

        audit_log.log(conn, user["id"], "sale.create", "sale", sale_id,
                      {"orderNo": order_no, "total": totals["total"], "paid": paid,
                       "tender": tender_currency})
        return build_bootstrap(conn, user)


@router.patch("/api/sales/{sale_id}/lines")
def edit_sale_lines(sale_id: str, body: SaleLinesPatchBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        if _has_returns(conn, sale_id):
            raise HTTPException(400, "This order has returns — cancel them before editing prices.")

        lines = _sale_lines(conn, sale_id)
        by_id = {line["id"]: line for line in lines}
        new_prices = {}
        for patch in body.lines:
            if patch.saleItemId not in by_id:
                raise HTTPException(400, "A price edit references a missing line.")
            new_prices[patch.saleItemId] = round_base_money(patch.unitPrice)

        old_subtotal = sale["subtotal"]
        new_line_totals = []
        for line in lines:
            price = new_prices.get(line["id"], line["unitPrice"])
            new_line_totals.append(round_base_money(line["qty"] * price))
        new_subtotal = round_base_money(sum(new_line_totals))

        # Proportional discount rescale (ports server:3279-3295).
        new_discount = 0.0
        if old_subtotal > 0 and sale["discountAmount"] > 0:
            new_discount = round_base_money(
                sale["discountAmount"] * new_subtotal / old_subtotal)
        new_discount = min(new_discount, new_subtotal)
        tax_rate = effective_tax_rate(sale)
        totals = compute_totals(new_line_totals, new_discount, tax_rate)

        new_due = round_base_money(totals["total"] - sale["returnedAmount"] - sale["paidAmount"])
        if new_due < -MONEY_EPSILON:
            raise HTTPException(
                400, "New total is below what's already paid — reset the payment first.")

        for line, line_total in zip(lines, new_line_totals):
            price = new_prices.get(line["id"], line["unitPrice"])
            conn.execute("UPDATE sale_items SET unit_price = ?, line_total = ? WHERE id = ?",
                         (price, line_total, line["id"]))
        conn.execute(
            "UPDATE sales SET subtotal = ?, discount_amount = ?, tax_amount = ?, total = ? WHERE id = ?",
            (totals["subtotal"], totals["discount"], totals["tax"], totals["total"], sale_id))
        apply_settlement(conn, sale_id, paid=sale["paidAmount"], due=max(new_due, 0.0))

        # Debt requires an owner.
        if new_due > MONEY_EPSILON:
            customer = _resolve_customer(conn, sale["customerId"])
            if customer is None or customer["isSystem"]:
                raise HTTPException(400, "This edit leaves an unpaid amount — assign a real customer first.")

        audit_log.log(conn, user["id"], "sale.edit_lines", "sale", sale_id,
                      {"edited": len(new_prices), "newTotal": totals["total"]})
        return build_bootstrap(conn, user)


@router.patch("/api/sales/{sale_id}/customer")
def edit_sale_customer(sale_id: str, body: SaleCustomerPatchBody,
                       user=Depends(require_user("manager"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        customer = _resolve_customer(conn, body.customerId)
        if sale["dueAmount"] > MONEY_EPSILON and (customer is None or customer["isSystem"]):
            raise HTTPException(400, "This order has an unpaid amount — it needs a real customer.")
        conn.execute("UPDATE sales SET customer_id = ? WHERE id = ?", (body.customerId, sale_id))
        conn.execute("UPDATE payments SET customer_id = ? WHERE sale_id = ?",
                     (body.customerId, sale_id))
        audit_log.log(conn, user["id"], "sale.edit_customer", "sale", sale_id,
                      {"customerId": body.customerId})
        return build_bootstrap(conn, user)


@router.patch("/api/sales/{sale_id}/discount")
def edit_sale_discount(sale_id: str, body: SaleDiscountPatchBody,
                       user=Depends(require_user("manager"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        if _has_returns(conn, sale_id):
            raise HTTPException(400, "This order has returns — cancel them before editing the discount.")
        line_totals = [line["lineTotal"] for line in _sale_lines(conn, sale_id)]
        tax_rate = effective_tax_rate(sale)
        totals = compute_totals(line_totals, body.discountAmount, tax_rate)
        reason = enforce_discount_reason(totals["discount"], totals["subtotal"],
                                         body.discountReason)
        new_due = round_base_money(totals["total"] - sale["returnedAmount"] - sale["paidAmount"])
        if new_due < -MONEY_EPSILON:
            raise HTTPException(
                400, "New total is below what's already paid — reset the payment first.")
        if new_due > MONEY_EPSILON:
            customer = _resolve_customer(conn, sale["customerId"])
            if customer is None or customer["isSystem"]:
                raise HTTPException(400, "This edit leaves an unpaid amount — assign a real customer first.")
        conn.execute(
            "UPDATE sales SET discount_amount = ?, discount_reason = ?, tax_amount = ?, total = ? WHERE id = ?",
            (totals["discount"], reason, totals["tax"], totals["total"], sale_id))
        apply_settlement(conn, sale_id, paid=sale["paidAmount"], due=max(new_due, 0.0))
        audit_log.log(conn, user["id"], "sale.edit_discount", "sale", sale_id,
                      {"discount": totals["discount"], "reason": reason})
        return build_bootstrap(conn, user)


@router.post("/api/sales/{sale_id}/reset-upfront")
def reset_upfront(sale_id: str, user=Depends(require_user("manager"))):
    """Move the register-paid amount back onto the customer's debt (ports reset-upfront)."""
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        upfront = sale["upfrontPaid"]
        if upfront <= MONEY_EPSILON:
            raise HTTPException(400, "This order has no register payment to reset.")
        customer = _resolve_customer(conn, sale["customerId"])
        if customer is None or customer["isSystem"]:
            raise HTTPException(400, "Resetting the payment creates debt — assign a real customer first.")
        apply_settlement(conn, sale_id,
                         paid=sale["paidAmount"] - upfront,
                         due=sale["dueAmount"] + upfront,
                         extra_sets=", upfront_paid = 0")
        audit_log.log(conn, user["id"], "sale.reset_upfront", "sale", sale_id,
                      {"amount": upfront})
        return build_bootstrap(conn, user)


@router.post("/api/sales/{sale_id}/void")
def void_sale(sale_id: str, body: VoidBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        if _has_payments(conn, sale_id):
            raise HTTPException(400, "Cancel this order's collections before voiding it.")
        if _has_returns(conn, sale_id):
            raise HTTPException(400, "Cancel this order's returns before voiding it.")
        now = db.now_iso()
        for line in _sale_lines(conn, sale_id):
            if not line["variantId"]:
                continue
            conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty + ? WHERE id = ?",
                         (line["qty"], line["variantId"]))
            conn.execute(
                """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                   unit_cost, ref_sale_id, note, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (db.new_id("mov"), line["variantId"], "void_restock", line["qty"],
                 line["unitCost"], sale_id, "Void: " + body.reason.strip(), user["id"], now),
            )
        conn.execute(
            """UPDATE sales SET status = 'voided', status_before_void = ?, void_reason = ?,
               voided_at = ?, voided_by = ? WHERE id = ?""",
            (sale["status"], body.reason.strip(), now, user["id"], sale_id))
        audit_log.log(conn, user["id"], "sale.void", "sale", sale_id,
                      {"reason": body.reason, "total": sale["total"]})
        return build_bootstrap(conn, user)


@router.delete("/api/sales/{sale_id}")
def delete_voided_sale(sale_id: str, user=Depends(require_user("admin"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        if sale["status"] != "voided":
            raise HTTPException(400, "Only voided orders can be deleted.")
        # Keep stock movements: the sale(-q)/void_restock(+q) pair nets zero and the
        # variant ledger must keep summing to stock_qty (audit check 1).
        conn.execute("DELETE FROM sale_items WHERE sale_id = ?", (sale_id,))
        conn.execute("DELETE FROM sales WHERE id = ?", (sale_id,))
        audit_log.log(conn, user["id"], "sale.delete", "sale", sale_id,
                      {"orderNo": sale.get("orderNo")})
        return build_bootstrap(conn, user)


@router.post("/api/sales/{sale_id}/returns")
def create_return(sale_id: str, body: ReturnBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        sale = _get_sale(conn, sale_id)
        _guard_not_voided(sale)
        customer = _resolve_customer(conn, sale["customerId"])
        if body.refundMethod == "store_credit" and (customer is None or customer["isSystem"]):
            raise HTTPException(400, "Walk-in returns are refunded in cash.")

        lines = {line["id"]: line for line in _sale_lines(conn, sale_id)}
        tax_rate = effective_tax_rate(sale)
        now = db.now_iso()
        return_id = db.new_id("ret")
        total_value = 0.0
        prepared = []
        for req in body.lines:
            line = lines.get(req.saleItemId)
            if line is None:
                raise HTTPException(400, "A return line references a missing sale line.")
            returnable = line["qty"] - line["returnedQty"]
            if req.qty > returnable:
                raise HTTPException(
                    400, f"Only {returnable} of \"{line['modelName']}\" can still be returned.")
            gross = round_base_money(line["unitPrice"] * req.qty)
            discount_share = 0.0
            if sale["subtotal"] > 0 and sale["discountAmount"] > 0:
                discount_share = round_base_money(
                    gross / sale["subtotal"] * sale["discountAmount"])
            taxable = round_base_money(gross - discount_share)
            tax_share = round_base_money(taxable * tax_rate / 100) if tax_rate > 0 else 0.0
            line_value = round_base_money(taxable + tax_share)
            total_value = round_base_money(total_value + line_value)
            prepared.append({"line": line, "qty": req.qty, "value": line_value})
        if total_value <= MONEY_EPSILON:
            raise HTTPException(400, "Nothing to refund.")

        # Settlement: the return first eats the open due; only the excess is refunded.
        applied_to_due = round_base_money(min(sale["dueAmount"], total_value))
        excess = round_base_money(total_value - applied_to_due)
        refund_cash = excess if body.refundMethod == "cash" else 0.0
        refund_credit = excess if body.refundMethod == "store_credit" else 0.0

        conn.execute(
            """INSERT INTO sale_returns (id, sale_id, customer_id, total_value,
               applied_to_due, refund_cash, refund_credit, refund_method, reason,
               tender_currency, tender_rate, user_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (return_id, sale_id, sale["customerId"], total_value, applied_to_due,
             refund_cash, refund_credit, body.refundMethod, body.reason,
             sale["tenderCurrency"], sale["tenderRate"], user["id"], now),
        )
        for p in prepared:
            line = p["line"]
            conn.execute(
                """INSERT INTO sale_return_items (id, return_id, sale_item_id, variant_id,
                   model_name, color, size, qty, unit_price, unit_cost, line_value)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (db.new_id("rli"), return_id, line["id"], line["variantId"],
                 line["modelName"], line["color"], line["size"], p["qty"],
                 line["unitPrice"], line["unitCost"], p["value"]),
            )
            conn.execute("UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?",
                         (p["qty"], line["id"]))
            if line["variantId"]:
                conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty + ? WHERE id = ?",
                             (p["qty"], line["variantId"]))
                conn.execute(
                    """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                       unit_cost, ref_sale_id, ref_return_id, user_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (db.new_id("mov"), line["variantId"], "return", p["qty"],
                     line["unitCost"], sale_id, return_id, user["id"], now),
                )

        if refund_credit > 0:
            conn.execute("UPDATE customers SET store_credit = store_credit + ? WHERE id = ?",
                         (refund_credit, sale["customerId"]))

        remaining = conn.execute(
            "SELECT SUM(qty - returned_qty) AS left FROM sale_items WHERE sale_id = ?",
            (sale_id,)).fetchone()["left"]
        return_status = "full" if not remaining else "partial"
        new_returned = round_base_money(sale["returnedAmount"] + total_value)
        apply_settlement(conn, sale_id,
                         paid=sale["paidAmount"] - excess,
                         due=sale["dueAmount"] - applied_to_due,
                         extra_sets=", returned_amount = ?, return_status = ?",
                         extra_params=(new_returned, return_status))
        audit_log.log(conn, user["id"], "sale.return", "sale", sale_id,
                      {"value": total_value, "method": body.refundMethod,
                       "cash": refund_cash, "credit": refund_credit})
        return build_bootstrap(conn, user)


@router.post("/api/returns/{return_id}/cancel")
def cancel_return(return_id: str, user=Depends(require_user("admin"))):
    with db.tx() as conn:
        ret = db.one(conn, "SELECT * FROM sale_returns WHERE id = ?", (return_id,))
        if ret is None:
            raise HTTPException(404, "Return not found.")
        sale = _get_sale(conn, ret["saleId"])
        _guard_not_voided(sale)
        if ret["refundCredit"] > 0:
            customer = _resolve_customer(conn, ret["customerId"])
            if customer is None or customer["storeCredit"] < ret["refundCredit"] - MONEY_EPSILON:
                raise HTTPException(
                    400, "The store credit from this return was already spent — it can't be cancelled.")
            conn.execute("UPDATE customers SET store_credit = store_credit - ? WHERE id = ?",
                         (ret["refundCredit"], ret["customerId"]))
        now = db.now_iso()
        for item in db.rows(conn, "SELECT * FROM sale_return_items WHERE return_id = ?",
                            (return_id,)):
            if item["saleItemId"]:
                conn.execute("UPDATE sale_items SET returned_qty = returned_qty - ? WHERE id = ?",
                             (item["qty"], item["saleItemId"]))
            if item["variantId"]:
                conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty - ? WHERE id = ?",
                             (item["qty"], item["variantId"]))
                conn.execute(
                    """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                       unit_cost, ref_sale_id, ref_return_id, note, user_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (db.new_id("mov"), item["variantId"], "return", -item["qty"],
                     item["unitCost"], ret["saleId"], return_id, "Return cancelled",
                     user["id"], now),
                )
        conn.execute("DELETE FROM sale_return_items WHERE return_id = ?", (return_id,))
        conn.execute("DELETE FROM sale_returns WHERE id = ?", (return_id,))

        fully_returned = conn.execute(
            "SELECT SUM(returned_qty) AS r, SUM(qty - returned_qty) AS left FROM sale_items WHERE sale_id = ?",
            (ret["saleId"],)).fetchone()
        if not fully_returned["r"]:
            return_status = None
        elif not fully_returned["left"]:
            return_status = "full"
        else:
            return_status = "partial"
        excess = round_base_money(ret["refundCash"] + ret["refundCredit"])
        apply_settlement(conn, ret["saleId"],
                         paid=sale["paidAmount"] + excess,
                         due=sale["dueAmount"] + ret["appliedToDue"],
                         extra_sets=", returned_amount = ?, return_status = ?",
                         extra_params=(round_base_money(sale["returnedAmount"] - ret["totalValue"]),
                                       return_status))
        audit_log.log(conn, user["id"], "return.cancel", "return", return_id,
                      {"saleId": ret["saleId"], "value": ret["totalValue"]})
        return build_bootstrap(conn, user)
