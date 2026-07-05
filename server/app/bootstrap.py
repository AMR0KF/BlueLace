"""build_bootstrap — the single definition of the full-state payload.

Every mutation endpoint returns this (ports the original's bootstrap pattern,
local-db-server.mjs:1499): the client swaps its entire in-memory state on receipt.
"""
import json

from . import audit, db
from .auth import ROLE_SECTIONS
from .config import (CAP_AUDIT_LOGS, CAP_CASH_MOVEMENTS, CAP_PURCHASES,
                     CAP_STOCK_MOVEMENTS)
from .money import round_base_money
from .settings import get_settings


def purchase_label(purchase_no) -> str:
    return f"PUR-{int(purchase_no):05d}" if purchase_no else "PUR-?"


def build_bootstrap(conn, user: dict) -> dict:
    settings = get_settings(conn)

    users = db.rows(conn, "SELECT id, name, role, active, is_default_pin FROM pos_users ORDER BY name")
    for u in users:
        u["active"] = bool(u["active"])
        u["isDefaultPin"] = bool(u.pop("isDefaultPin", 0))
        u["sections"] = ROLE_SECTIONS.get(u["role"], [])

    models = db.rows(conn, "SELECT * FROM shoe_models ORDER BY sort_order, name")
    for m in models:
        m["active"] = bool(m["active"])
        if m.get("colorImages"):
            try:
                m["colorImages"] = json.loads(m["colorImages"])
            except (json.JSONDecodeError, TypeError):
                m["colorImages"] = None

    variants = db.rows(conn, "SELECT * FROM shoe_variants ORDER BY color, size")
    for v in variants:
        v["active"] = bool(v["active"])

    # Customers with derived balance (= sum of open dues). Server-derived, never stored.
    customers = db.rows(conn, "SELECT * FROM customers ORDER BY name")
    dues = {
        r["customer_id"]: r["open_due"]
        for r in conn.execute(
            """SELECT customer_id, SUM(due_amount) AS open_due FROM sales
               WHERE status IN ('partial','unpaid') AND customer_id IS NOT NULL
               GROUP BY customer_id"""
        )
    }
    for c in customers:
        c["isSystem"] = bool(c.pop("isSystem", 0))
        c["balance"] = round_base_money(dues.get(c["id"], 0.0))

    # Sales + nested lines. Cashiers see only their own sales (ports the original scoping).
    if user["role"] == "cashier":
        sales = db.rows(conn, "SELECT * FROM sales WHERE user_id = ? ORDER BY created_at DESC",
                        (user["id"],))
    else:
        sales = db.rows(conn, "SELECT * FROM sales ORDER BY created_at DESC")
    items_by_sale: dict[str, list] = {}
    for item in db.rows(conn, "SELECT * FROM sale_items"):
        items_by_sale.setdefault(item["saleId"], []).append(item)
    sale_ids = set()
    for s in sales:
        sale_ids.add(s["id"])
        s["lines"] = items_by_sale.get(s["id"], [])
        s["orderRef"] = f"ORD-{int(s['orderNo']):05d}" if s.get("orderNo") else s["id"][:10]

    payments = [p for p in db.rows(conn, "SELECT * FROM payments ORDER BY created_at DESC")
                if user["role"] != "cashier" or p["saleId"] in sale_ids]

    returns = db.rows(conn, "SELECT * FROM sale_returns ORDER BY created_at DESC")
    return_items: dict[str, list] = {}
    for item in db.rows(conn, "SELECT * FROM sale_return_items"):
        return_items.setdefault(item["returnId"], []).append(item)
    returns = [r for r in returns if user["role"] != "cashier" or r["saleId"] in sale_ids]
    for r in returns:
        r["lines"] = return_items.get(r["id"], [])

    stock_movements = db.rows(
        conn,
        """SELECT sm.*, v.color, v.size, v.model_id, m.name AS model_name
           FROM stock_movements sm
           JOIN shoe_variants v ON v.id = sm.variant_id
           JOIN shoe_models m ON m.id = v.model_id
           ORDER BY sm.created_at DESC LIMIT ?""",
        (CAP_STOCK_MOVEMENTS,),
    )

    review_queue = db.rows(
        conn,
        """SELECT sm.*, v.color, v.size, v.stock_qty, v.model_id, m.name AS model_name
           FROM stock_movements sm
           JOIN shoe_variants v ON v.id = sm.variant_id
           JOIN shoe_models m ON m.id = v.model_id
           WHERE sm.needs_review = 1 AND sm.reviewed_at IS NULL
           ORDER BY sm.created_at DESC""",
    )

    cash_movements = db.rows(
        conn, "SELECT * FROM cash_drawer_movements ORDER BY created_at DESC LIMIT ?",
        (CAP_CASH_MOVEMENTS,),
    )

    suppliers = db.rows(conn, "SELECT * FROM suppliers ORDER BY name")
    for s in suppliers:
        s["active"] = bool(s["active"])

    purchases = db.rows(conn, "SELECT * FROM purchases ORDER BY created_at DESC LIMIT ?",
                        (CAP_PURCHASES,))
    purchase_items: dict[str, list] = {}
    for item in db.rows(conn, "SELECT * FROM purchase_items"):
        purchase_items.setdefault(item["purchaseId"], []).append(item)
    for p in purchases:
        p["lines"] = purchase_items.get(p["id"], [])
        p["purchaseRef"] = purchase_label(p.get("purchaseNo")) if p.get("purchaseNo") \
            else p["id"][:10]

    audit_logs = db.rows(conn, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?",
                         (CAP_AUDIT_LOGS,))
    for entry in audit_logs:
        if entry.get("detail"):
            try:
                entry["detail"] = json.loads(entry["detail"])
            except (json.JSONDecodeError, TypeError):
                pass

    return {
        "serverTime": db.now_iso(),
        "settings": settings,
        "posUser": {"id": user["id"], "name": user["name"], "role": user["role"],
                     "sections": ROLE_SECTIONS.get(user["role"], [])},
        "users": users,
        "models": models,
        "variants": variants,
        "customers": customers,
        "sales": sales,
        "payments": payments,
        "saleReturns": returns,
        "stockMovements": stock_movements,
        "stockReviewItems": review_queue,
        "cashDrawerMovements": cash_movements,
        "suppliers": suppliers,
        "purchases": purchases,
        "auditChecks": audit.run_checks(conn),
        "auditLogs": audit_logs,
    }
