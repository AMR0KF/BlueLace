"""Shoe models, variants (color x size), price overrides, stock receive/adjust,
oversell review queue."""
import json

from fastapi import APIRouter, Depends, HTTPException

from .. import audit_log, db
from ..auth import require_user
from ..bootstrap import build_bootstrap
from ..money import round_base_money
from ..schemas import (AdjustStockBody, ModelBody, ModelPatchBody, ReceiveStockBody,
                       ReviewResolveBody, VariantMatrixBody, VariantPatchBody)

router = APIRouter()


def _get_model(conn, model_id: str) -> dict:
    model = db.one(conn, "SELECT * FROM shoe_models WHERE id = ?", (model_id,))
    if model is None:
        raise HTTPException(404, "Shoe model not found.")
    return model


def _get_variant(conn, variant_id: str) -> dict:
    variant = db.one(conn, "SELECT * FROM shoe_variants WHERE id = ?", (variant_id,))
    if variant is None:
        raise HTTPException(404, "Variant not found.")
    return variant


@router.post("/api/models")
def create_model(body: ModelBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        model_id = db.new_id("shoe")
        conn.execute(
            """INSERT INTO shoe_models (id, name, brand, category, image, color_images,
               tile_color, base_price, default_cost, sort_order, active, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,1,?)""",
            (model_id, body.name.strip(), body.brand, body.category, body.image,
             json.dumps(body.colorImages) if body.colorImages else None,
             body.tileColor, round_base_money(body.basePrice),
             round_base_money(body.defaultCost), body.sortOrder, db.now_iso()),
        )
        audit_log.log(conn, user["id"], "model.create", "model", model_id,
                      {"name": body.name})
        return build_bootstrap(conn, user)


@router.patch("/api/models/{model_id}")
def update_model(model_id: str, body: ModelPatchBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        model = _get_model(conn, model_id)
        fields = {
            "name": body.name.strip() if body.name is not None else None,
            "brand": body.brand, "category": body.category, "image": body.image,
            "color_images": json.dumps(body.colorImages) if body.colorImages else None,
            "tile_color": body.tileColor,
            "base_price": round_base_money(body.basePrice) if body.basePrice is not None else None,
            "default_cost": round_base_money(body.defaultCost) if body.defaultCost is not None else None,
            "sort_order": body.sortOrder,
            "active": int(body.active) if body.active is not None else None,
        }
        sets = {k: v for k, v in fields.items() if v is not None or k in _explicit_nullable(body)}
        if not sets:
            return build_bootstrap(conn, user)
        assignments = ", ".join(f"{k} = ?" for k in sets)
        conn.execute(f"UPDATE shoe_models SET {assignments} WHERE id = ?",
                     (*sets.values(), model_id))
        if body.active is False:
            conn.execute("UPDATE shoe_variants SET active = 0 WHERE model_id = ?", (model_id,))
        audit_log.log(conn, user["id"], "model.update", "model", model_id,
                      {"fields": list(sets.keys()), "name": model["name"]})
        return build_bootstrap(conn, user)


def _explicit_nullable(body: ModelPatchBody) -> set[str]:
    provided = body.model_dump(exclude_unset=True)
    nullable = set()
    for key, column in (("brand", "brand"), ("category", "category"), ("image", "image"),
                        ("colorImages", "color_images"), ("tileColor", "tile_color")):
        if key in provided:
            nullable.add(column)
    return nullable


@router.delete("/api/models/{model_id}")
def delete_model(model_id: str, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        model = _get_model(conn, model_id)
        has_history = conn.execute(
            """SELECT 1 FROM shoe_variants v WHERE v.model_id = ? AND (
                 EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.variant_id = v.id)
                 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.variant_id = v.id)
               ) LIMIT 1""", (model_id,)).fetchone()
        if has_history:
            # Never hard-delete referenced catalog rows — soft-deactivate (plan invariant 8).
            conn.execute("UPDATE shoe_models SET active = 0 WHERE id = ?", (model_id,))
            conn.execute("UPDATE shoe_variants SET active = 0 WHERE model_id = ?", (model_id,))
            audit_log.log(conn, user["id"], "model.deactivate", "model", model_id,
                          {"name": model["name"]})
        else:
            conn.execute("DELETE FROM shoe_variants WHERE model_id = ?", (model_id,))
            conn.execute("DELETE FROM shoe_models WHERE id = ?", (model_id,))
            audit_log.log(conn, user["id"], "model.delete", "model", model_id,
                          {"name": model["name"]})
        return build_bootstrap(conn, user)


@router.post("/api/models/{model_id}/variants")
def upsert_variants(model_id: str, body: VariantMatrixBody, user=Depends(require_user("manager"))):
    """Bulk color x size matrix upsert. With prune=true, variants missing from the
    payload are deleted (no history) or deactivated (has history)."""
    with db.tx() as conn:
        _get_model(conn, model_id)
        seen: set[tuple[str, str]] = set()
        for spec in body.variants:
            color, size = spec.color.strip(), spec.size.strip()
            key = (color.lower(), size.lower())
            if key in seen:
                raise HTTPException(400, f"Duplicate variant {color}/{size} in payload.")
            seen.add(key)
            existing = db.one(
                conn,
                "SELECT * FROM shoe_variants WHERE model_id = ? AND lower(color) = ? AND lower(size) = ?",
                (model_id, key[0], key[1]),
            )
            override = round_base_money(spec.priceOverride) if spec.priceOverride is not None else None
            if existing:
                conn.execute(
                    """UPDATE shoe_variants SET sku = ?, barcode = ?, price_override = ?, active = 1
                       WHERE id = ?""",
                    (spec.sku, spec.barcode, override, existing["id"]),
                )
            else:
                conn.execute(
                    """INSERT INTO shoe_variants (id, model_id, color, size, sku, barcode,
                       price_override, stock_qty, active) VALUES (?,?,?,?,?,?,?,0,1)""",
                    (db.new_id("var"), model_id, color, size, spec.sku, spec.barcode, override),
                )
        if body.prune:
            for row in conn.execute(
                "SELECT id, color, size FROM shoe_variants WHERE model_id = ?", (model_id,)
            ).fetchall():
                if (row["color"].lower(), row["size"].lower()) in seen:
                    continue
                has_history = conn.execute(
                    """SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1""",
                    (row["id"],)).fetchone() or conn.execute(
                    """SELECT 1 FROM sale_items WHERE variant_id = ? LIMIT 1""",
                    (row["id"],)).fetchone()
                if has_history:
                    conn.execute("UPDATE shoe_variants SET active = 0 WHERE id = ?", (row["id"],))
                else:
                    conn.execute("DELETE FROM shoe_variants WHERE id = ?", (row["id"],))
        audit_log.log(conn, user["id"], "variants.upsert", "model", model_id,
                      {"count": len(body.variants), "prune": body.prune})
        return build_bootstrap(conn, user)


@router.patch("/api/variants/{variant_id}")
def update_variant(variant_id: str, body: VariantPatchBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        variant = _get_variant(conn, variant_id)
        provided = body.model_dump(exclude_unset=True)
        if "sku" in provided:
            conn.execute("UPDATE shoe_variants SET sku = ? WHERE id = ?", (body.sku, variant_id))
        if "barcode" in provided:
            conn.execute("UPDATE shoe_variants SET barcode = ? WHERE id = ?", (body.barcode, variant_id))
        if body.clearPriceOverride:
            conn.execute("UPDATE shoe_variants SET price_override = NULL WHERE id = ?", (variant_id,))
        elif body.priceOverride is not None:
            conn.execute("UPDATE shoe_variants SET price_override = ? WHERE id = ?",
                         (round_base_money(body.priceOverride), variant_id))
        if body.active is not None:
            conn.execute("UPDATE shoe_variants SET active = ? WHERE id = ?",
                         (int(body.active), variant_id))
        audit_log.log(conn, user["id"], "variant.update", "variant", variant_id,
                      {"color": variant["color"], "size": variant["size"]})
        return build_bootstrap(conn, user)


@router.post("/api/stock/receive")
def receive_stock(body: ReceiveStockBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        variant = _get_variant(conn, body.variantId)
        unit_cost = round_base_money(body.unitCost)
        conn.execute(
            "UPDATE shoe_variants SET stock_qty = stock_qty + ?, last_cost = ? WHERE id = ?",
            (body.qty, unit_cost, body.variantId),
        )
        conn.execute(
            """INSERT INTO stock_movements (id, variant_id, movement_type, qty, unit_cost,
               note, user_id, created_at) VALUES (?,?,?,?,?,?,?,?)""",
            (db.new_id("mov"), body.variantId, "receive", body.qty, unit_cost,
             body.note, user["id"], db.now_iso()),
        )
        audit_log.log(conn, user["id"], "stock.receive", "variant", body.variantId,
                      {"qty": body.qty, "unitCost": unit_cost,
                       "color": variant["color"], "size": variant["size"]})
        return build_bootstrap(conn, user)


@router.post("/api/stock/adjust")
def adjust_stock(body: AdjustStockBody, user=Depends(require_user("manager"))):
    if body.qtyDelta == 0:
        raise HTTPException(400, "Adjustment can't be zero.")
    with db.tx() as conn:
        variant = _get_variant(conn, body.variantId)
        conn.execute("UPDATE shoe_variants SET stock_qty = stock_qty + ? WHERE id = ?",
                     (body.qtyDelta, body.variantId))
        conn.execute(
            """INSERT INTO stock_movements (id, variant_id, movement_type, qty, note,
               user_id, created_at) VALUES (?,?,?,?,?,?,?)""",
            (db.new_id("mov"), body.variantId, "adjustment", body.qtyDelta,
             body.reason.strip(), user["id"], db.now_iso()),
        )
        audit_log.log(conn, user["id"], "stock.adjust", "variant", body.variantId,
                      {"delta": body.qtyDelta, "reason": body.reason,
                       "color": variant["color"], "size": variant["size"]})
        return build_bootstrap(conn, user)


@router.post("/api/stock/review/{movement_id}/resolve")
def resolve_review(movement_id: str, body: ReviewResolveBody,
                   user=Depends(require_user("manager"))):
    with db.tx() as conn:
        movement = db.one(conn, "SELECT * FROM stock_movements WHERE id = ?", (movement_id,))
        if movement is None or not movement["needsReview"]:
            raise HTTPException(404, "Review item not found.")
        if movement["reviewedAt"]:
            raise HTTPException(400, "Already reviewed.")
        conn.execute(
            "UPDATE stock_movements SET reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?",
            (db.now_iso(), user["id"], body.note, movement_id),
        )
        audit_log.log(conn, user["id"], "stock.review", "movement", movement_id,
                      {"note": body.note})
        return build_bootstrap(conn, user)
