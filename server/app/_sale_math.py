"""Shared sale money math. Ports the original's totals/settlement formulas
(local-db-server.mjs:3190-3295) with 2dp base rounding at every labeled step.
"""
from fastapi import HTTPException

from .config import LARGE_DISCOUNT_PERCENT, MONEY_EPSILON
from .money import money_eq, round_base_money


def compute_totals(line_totals: list[float], discount: float, tax_rate: float) -> dict:
    subtotal = round_base_money(sum(line_totals))
    discount = round_base_money(discount)
    if discount < 0 or discount > subtotal + MONEY_EPSILON:
        raise HTTPException(400, "Discount can't exceed the subtotal.")
    discount = min(discount, subtotal)
    taxable = round_base_money(subtotal - discount)
    tax = round_base_money(taxable * tax_rate / 100) if tax_rate > 0 else 0.0
    total = round_base_money(taxable + tax)
    return {"subtotal": subtotal, "discount": discount, "tax": tax, "total": total}


def enforce_discount_reason(discount: float, subtotal: float, reason: str | None) -> str | None:
    """Discounts at or above LARGE_DISCOUNT_PERCENT of the subtotal require a reason.
    Server-enforced (the original only checked client-side, App.tsx:8599)."""
    reason = (reason or "").strip()[:200] or None
    if subtotal <= 0 or discount <= 0:
        return reason
    percent = discount / subtotal * 100
    if percent >= LARGE_DISCOUNT_PERCENT - 0.01 and not reason:
        raise HTTPException(
            400, f"A discount of {LARGE_DISCOUNT_PERCENT}% or more needs a reason."
        )
    return reason


def status_for(paid: float, due: float) -> str:
    if money_eq(due, 0):
        return "completed"
    if money_eq(paid, 0):
        return "unpaid"
    return "partial"


def apply_settlement(conn, sale_id: str, *, paid: float, due: float,
                     extra_sets: str = "", extra_params: tuple = ()) -> None:
    paid = round_base_money(paid)
    due = round_base_money(max(due, 0.0))
    status = status_for(paid, due)
    conn.execute(
        f"UPDATE sales SET paid_amount = ?, due_amount = ?, status = ?{extra_sets} WHERE id = ?",
        (paid, due, status, *extra_params, sale_id),
    )


def effective_tax_rate(sale: dict) -> float:
    """Recover the tax rate frozen into a sale (for return-value math)."""
    taxable = sale["subtotal"] - sale["discountAmount"]
    if taxable <= 0 or sale["taxAmount"] <= 0:
        return 0.0
    return sale["taxAmount"] / taxable * 100
