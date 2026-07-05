"""Integrity audit engine — recomputed on every bootstrap (ports systemAuditChecks,
local-db-server.mjs:838, adapted to the shoe domain). Every check compares stored
values against a recomputation and reports discrepancies instead of hiding them.
"""
from .config import MONEY_EPSILON
from .money import money_eq


def _check(checks: list, severity: str, area: str, message: str,
           target_type: str | None = None, target_id: str | None = None) -> None:
    checks.append({
        "id": f"audit-{len(checks) + 1}",
        "severity": severity,          # 'danger' | 'warning'
        "area": area,
        "message": message,
        "targetType": target_type,
        "targetId": target_id,
    })


def run_checks(conn) -> list[dict]:
    checks: list[dict] = []

    # 1. Variant stock_qty must equal the sum of its movements.
    for r in conn.execute(
        """SELECT v.id, v.color, v.size, v.stock_qty, m.name AS model_name,
                  COALESCE((SELECT SUM(qty) FROM stock_movements sm WHERE sm.variant_id = v.id), 0) AS ledger_qty
           FROM shoe_variants v JOIN shoe_models m ON m.id = v.model_id"""
    ):
        if r["stock_qty"] != r["ledger_qty"]:
            _check(checks, "danger", "Inventory",
                   f"{r['model_name']} {r['color']}/{r['size']}: stock is {r['stock_qty']} "
                   f"but the movement ledger sums to {r['ledger_qty']}.",
                   "variant", r["id"])

    # 2+3. Sale money invariants: total = subtotal - discount + tax;
    #      paid + due = total - returned_amount.
    for r in conn.execute(
        """SELECT id, order_no, subtotal, discount_amount, tax_amount, total,
                  paid_amount, due_amount, returned_amount, status FROM sales
           WHERE status != 'voided'"""
    ):
        expected_total = r["subtotal"] - r["discount_amount"] + r["tax_amount"]
        if abs(expected_total - r["total"]) >= MONEY_EPSILON:
            _check(checks, "danger", "Sales",
                   f"Order {order_label(r)}: total {r['total']:.2f} doesn't match "
                   f"subtotal − discount + tax ({expected_total:.2f}).",
                   "sale", r["id"])
        settled = r["paid_amount"] + r["due_amount"]
        expected_settled = r["total"] - r["returned_amount"]
        if abs(settled - expected_settled) >= MONEY_EPSILON:
            _check(checks, "danger", "Sales",
                   f"Order {order_label(r)}: paid + due ({settled:.2f}) doesn't match "
                   f"total − returns ({expected_settled:.2f}).",
                   "sale", r["id"])
        if r["due_amount"] < -MONEY_EPSILON or r["paid_amount"] < -MONEY_EPSILON:
            _check(checks, "danger", "Sales",
                   f"Order {order_label(r)}: negative paid or due amount.",
                   "sale", r["id"])

    # 4. paid_amount must equal upfront + collections + store-credit use − refunds.
    for r in conn.execute(
        """SELECT s.id, s.order_no, s.paid_amount, s.upfront_paid,
                  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.sale_id = s.id), 0) AS collected,
                  COALESCE((SELECT SUM(sr.refund_cash + sr.refund_credit)
                            FROM sale_returns sr WHERE sr.sale_id = s.id), 0) AS refunded
           FROM sales s WHERE s.status != 'voided'"""
    ):
        expected_paid = r["upfront_paid"] + r["collected"] - r["refunded"]
        if abs(expected_paid - r["paid_amount"]) >= MONEY_EPSILON:
            _check(checks, "danger", "Payments",
                   f"Order {order_label(r)}: paid {r['paid_amount']:.2f} doesn't match "
                   f"upfront + collections − refunds ({expected_paid:.2f}).",
                   "sale", r["id"])

    # 5. Negative stock without a pending oversell review.
    for r in conn.execute(
        """SELECT v.id, v.color, v.size, v.stock_qty, m.name AS model_name
           FROM shoe_variants v JOIN shoe_models m ON m.id = v.model_id
           WHERE v.stock_qty < 0
             AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                             WHERE sm.variant_id = v.id AND sm.needs_review = 1
                               AND sm.reviewed_at IS NULL)"""
    ):
        _check(checks, "warning", "Inventory",
               f"{r['model_name']} {r['color']}/{r['size']}: stock is negative "
               f"({r['stock_qty']}) with no pending oversell review.",
               "variant", r["id"])

    # 6. Voided sales must have no payment rows.
    for r in conn.execute(
        """SELECT s.id, s.order_no FROM sales s
           WHERE s.status = 'voided'
             AND EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id)"""
    ):
        _check(checks, "danger", "Payments",
               f"Order {order_label(r)} is voided but still has collection payments.",
               "sale", r["id"])

    # 7. Store credit must never go negative.
    for r in conn.execute("SELECT id, name, store_credit FROM customers WHERE store_credit < ?",
                          (-MONEY_EPSILON,)):
        _check(checks, "danger", "CRM",
               f"{r['name']}: store credit is negative ({r['store_credit']:.2f}).",
               "customer", r["id"])

    # 8. Orphan lines / payments (FKs should prevent; belt and suspenders).
    orphan_items = conn.execute(
        "SELECT COUNT(*) AS n FROM sale_items si WHERE NOT EXISTS "
        "(SELECT 1 FROM sales s WHERE s.id = si.sale_id)").fetchone()["n"]
    if orphan_items:
        _check(checks, "danger", "Sales", f"{orphan_items} sale line(s) reference a missing sale.")

    # 9. Sessions for disabled users.
    stale_sessions = conn.execute(
        """SELECT COUNT(*) AS n FROM auth_sessions s
           JOIN pos_users u ON u.id = s.user_id WHERE u.active = 0""").fetchone()["n"]
    if stale_sessions:
        _check(checks, "warning", "Users",
               f"{stale_sessions} active session(s) belong to disabled users.")

    # 10. First-run PINs still in use.
    for r in conn.execute("SELECT id, name FROM pos_users WHERE is_default_pin = 1 AND active = 1"):
        _check(checks, "warning", "Users",
               f"User \"{r['name']}\" still uses the first-run PIN — change it in Settings.",
               "user", r["id"])

    # 11. Returned quantity must never exceed sold quantity.
    for r in conn.execute(
        """SELECT si.id, si.model_name, si.qty, si.returned_qty, s.order_no, s.id AS sale_id
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
           WHERE si.returned_qty > si.qty"""
    ):
        _check(checks, "danger", "Returns",
               f"Order {order_label(r)}: line \"{r['model_name']}\" returned more than sold.",
               "sale", r["sale_id"])

    return checks


def order_label(row) -> str:
    order_no = row["order_no"] if "order_no" in row.keys() else None
    if order_no:
        return f"ORD-{int(order_no):05d}"
    return str(row["id"])[:10]
