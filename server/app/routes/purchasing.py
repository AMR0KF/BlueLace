"""Suppliers and purchases (goods-in).

A purchase receives stock in one document: each line increments variant stock,
updates last_cost, and writes a stock_movements 'receive' row carrying
ref_purchase_id. An optional paid-from-drawer amount writes one
cash_drawer_movements 'paid_out' row (category 'supplier') so the drawer ledger
stays derived from real events. Voiding reverses stock with 'adjustment' rows and
refunds the drawer with a 'cash_in' row — history is never deleted.
"""
from fastapi import APIRouter, Depends, HTTPException

from .. import audit_log, db
from ..auth import require_user
from ..bootstrap import build_bootstrap, purchase_label
from ..money import round_base_money
from ..schemas import PurchaseBody, SupplierBody, SupplierPatchBody, VoidBody
from ..settings import get_settings

router = APIRouter()


def _get_supplier(conn, supplier_id: str) -> dict:
    supplier = db.one(conn, "SELECT * FROM suppliers WHERE id = ?", (supplier_id,))
    if supplier is None:
        raise HTTPException(404, "Supplier not found.")
    return supplier


# ---------- Suppliers ----------

@router.post("/api/suppliers")
def create_supplier(body: SupplierBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        supplier_id = db.new_id("sup")
        conn.execute(
            "INSERT INTO suppliers (id, name, phone, note, active, created_at) VALUES (?,?,?,?,1,?)",
            (supplier_id, body.name.strip(), body.phone, body.note, db.now_iso()),
        )
        audit_log.log(conn, user["id"], "supplier.create", "supplier", supplier_id,
                      {"name": body.name})
        return build_bootstrap(conn, user)


@router.patch("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: str, body: SupplierPatchBody,
                    user=Depends(require_user("manager"))):
    with db.tx() as conn:
        supplier = _get_supplier(conn, supplier_id)
        provided = body.model_dump(exclude_unset=True)
        sets = {}
        if body.name is not None:
            sets["name"] = body.name.strip()
        if "phone" in provided:
            sets["phone"] = body.phone
        if "note" in provided:
            sets["note"] = body.note
        if body.active is not None:
            sets["active"] = int(body.active)
        if sets:
            assignments = ", ".join(f"{k} = ?" for k in sets)
            conn.execute(f"UPDATE suppliers SET {assignments} WHERE id = ?",
                         (*sets.values(), supplier_id))
            audit_log.log(conn, user["id"], "supplier.update", "supplier", supplier_id,
                          {"fields": list(sets.keys()), "name": supplier["name"]})
        return build_bootstrap(conn, user)


@router.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: str, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        supplier = _get_supplier(conn, supplier_id)
        has_history = conn.execute(
            "SELECT 1 FROM purchases WHERE supplier_id = ? LIMIT 1", (supplier_id,)
        ).fetchone()
        if has_history:
            # Referenced by purchases — soft-deactivate (same invariant as catalog).
            conn.execute("UPDATE suppliers SET active = 0 WHERE id = ?", (supplier_id,))
            audit_log.log(conn, user["id"], "supplier.deactivate", "supplier",
                          supplier_id, {"name": supplier["name"]})
        else:
            conn.execute("DELETE FROM suppliers WHERE id = ?", (supplier_id,))
            audit_log.log(conn, user["id"], "supplier.delete", "supplier", supplier_id,
                          {"name": supplier["name"]})
        return build_bootstrap(conn, user)


# ---------- Purchases ----------

@router.post("/api/purchases")
def create_purchase(body: PurchaseBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        settings = get_settings(conn)
        supplier = _get_supplier(conn, body.supplierId) if body.supplierId else None

        # Reject duplicate variants in one document — merge client-side instead.
        seen: set[str] = set()
        for line in body.lines:
            if line.variantId in seen:
                raise HTTPException(400, "Duplicate variant lines — merge quantities first.")
            seen.add(line.variantId)

        prepared = []
        for line in body.lines:
            row = db.one(
                conn,
                """SELECT v.*, m.name AS model_name FROM shoe_variants v
                   JOIN shoe_models m ON m.id = v.model_id WHERE v.id = ?""",
                (line.variantId,),
            )
            if row is None:
                raise HTTPException(400, "A purchase line references a missing variant.")
            unit_cost = round_base_money(line.unitCost)
            prepared.append({
                "variantId": line.variantId, "modelName": row["modelName"],
                "color": row["color"], "size": row["size"], "sku": row["sku"],
                "qty": line.qty, "unitCost": unit_cost,
                "lineTotal": round_base_money(line.qty * unit_cost),
            })

        total_cost = round_base_money(sum(p["lineTotal"] for p in prepared))
        paid = round_base_money(min(body.paidFromDrawer, total_cost))
        items_count = sum(p["qty"] for p in prepared)

        purchase_id = db.new_id("pur")
        purchase_no = (conn.execute(
            "SELECT COALESCE(MAX(purchase_no), 0) FROM purchases").fetchone()[0]) + 1
        now = db.now_iso()
        conn.execute(
            """INSERT INTO purchases (id, purchase_no, supplier_id, invoice_no, status,
               total_cost, items_count, paid_amount, notes, user_id, created_at)
               VALUES (?,?,?,?,'received',?,?,?,?,?,?)""",
            (purchase_id, purchase_no, body.supplierId, body.invoiceNo, total_cost,
             items_count, paid, body.notes, user["id"], now),
        )

        label = purchase_label(purchase_no)
        move_note = label if supplier is None else f"{label} · {supplier['name']}"
        for p in prepared:
            conn.execute(
                """INSERT INTO purchase_items (id, purchase_id, variant_id, model_name,
                   color, size, sku, qty, unit_cost, line_total) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (db.new_id("pit"), purchase_id, p["variantId"], p["modelName"],
                 p["color"], p["size"], p["sku"], p["qty"], p["unitCost"], p["lineTotal"]),
            )
            conn.execute(
                "UPDATE shoe_variants SET stock_qty = stock_qty + ?, last_cost = ? WHERE id = ?",
                (p["qty"], p["unitCost"], p["variantId"]),
            )
            conn.execute(
                """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                   unit_cost, ref_purchase_id, note, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (db.new_id("mov"), p["variantId"], "receive", p["qty"], p["unitCost"],
                 purchase_id, move_note, user["id"], now),
            )

        if paid > 0:
            conn.execute(
                """INSERT INTO cash_drawer_movements (id, amount, movement_type, category,
                   notes, tender_currency, tender_rate, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (db.new_id("cdm"), -paid, "paid_out", "supplier",
                 f"{label}{' · ' + supplier['name'] if supplier else ''}",
                 settings["baseCurrency"], settings["exchangeRate"], user["id"], now),
            )

        audit_log.log(conn, user["id"], "purchase.create", "purchase", purchase_id,
                      {"purchaseNo": purchase_no, "total": total_cost, "paid": paid,
                       "items": items_count,
                       "supplier": supplier["name"] if supplier else None})
        return build_bootstrap(conn, user)


@router.post("/api/purchases/{purchase_id}/void")
def void_purchase(purchase_id: str, body: VoidBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        settings = get_settings(conn)
        purchase = db.one(conn, "SELECT * FROM purchases WHERE id = ?", (purchase_id,))
        if purchase is None:
            raise HTTPException(404, "Purchase not found.")
        if purchase["status"] == "voided":
            raise HTTPException(400, "This purchase is already voided.")

        label = purchase_label(purchase.get("purchaseNo"))
        now = db.now_iso()
        items = db.rows(conn, "SELECT * FROM purchase_items WHERE purchase_id = ?",
                        (purchase_id,))
        for item in items:
            if not item["variantId"]:
                continue
            conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty - ? WHERE id = ?",
                         (item["qty"], item["variantId"]))
            conn.execute(
                """INSERT INTO stock_movements (id, variant_id, movement_type, qty,
                   unit_cost, ref_purchase_id, note, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (db.new_id("mov"), item["variantId"], "adjustment", -item["qty"],
                 item["unitCost"], purchase_id, f"Void {label}: {body.reason.strip()}",
                 user["id"], now),
            )

        if purchase["paidAmount"] > 0:
            conn.execute(
                """INSERT INTO cash_drawer_movements (id, amount, movement_type, category,
                   notes, tender_currency, tender_rate, user_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (db.new_id("cdm"), round_base_money(purchase["paidAmount"]), "cash_in",
                 "supplier", f"Refund — void {label}",
                 settings["baseCurrency"], settings["exchangeRate"], user["id"], now),
            )

        conn.execute(
            """UPDATE purchases SET status = 'voided', void_reason = ?, voided_at = ?,
               voided_by = ? WHERE id = ?""",
            (body.reason.strip(), now, user["id"], purchase_id),
        )
        audit_log.log(conn, user["id"], "purchase.void", "purchase", purchase_id,
                      {"purchaseNo": purchase.get("purchaseNo"), "reason": body.reason})
        return build_bootstrap(conn, user)
