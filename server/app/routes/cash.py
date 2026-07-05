"""Manual cash-drawer movements (paid-outs and cash-ins). Sales cash-in,
collections and return refunds are derived from their own tables — no double entry."""
from fastapi import APIRouter, Depends, HTTPException

from .. import audit_log, db
from ..auth import require_user
from ..bootstrap import build_bootstrap
from ..money import round_base_money
from ..schemas import CashMovementBody
from ..settings import get_settings

router = APIRouter()


@router.post("/api/cash/movements")
def create_movement(body: CashMovementBody, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        settings = get_settings(conn)
        tender_currency = body.tenderCurrency.strip().upper()
        if tender_currency not in (settings["baseCurrency"], settings["secondaryCurrency"]):
            raise HTTPException(400, "Unknown tender currency.")
        amount = round_base_money(body.amountBase)
        signed = -amount if body.movementType == "paid_out" else amount
        movement_id = db.new_id("cdm")
        conn.execute(
            """INSERT INTO cash_drawer_movements (id, amount, movement_type, category,
               notes, tender_currency, tender_rate, user_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (movement_id, signed, body.movementType, body.category, body.notes,
             tender_currency, settings["exchangeRate"], user["id"], db.now_iso()),
        )
        audit_log.log(conn, user["id"], "cash." + body.movementType, "cash_movement",
                      movement_id, {"amount": signed, "category": body.category})
        return build_bootstrap(conn, user)


@router.delete("/api/cash/movements/{movement_id}")
def delete_movement(movement_id: str, user=Depends(require_user("manager"))):
    with db.tx() as conn:
        movement = db.one(conn, "SELECT * FROM cash_drawer_movements WHERE id = ?",
                          (movement_id,))
        if movement is None:
            raise HTTPException(404, "Movement not found.")
        conn.execute("DELETE FROM cash_drawer_movements WHERE id = ?", (movement_id,))
        audit_log.log(conn, user["id"], "cash.delete", "cash_movement", movement_id,
                      {"amount": movement["amount"], "category": movement["category"]})
        return build_bootstrap(conn, user)
