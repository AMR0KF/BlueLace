"""Money discipline. All stored money is base currency (USD), rounded to 2dp.

Never compare money with ==; use money_eq / money_lte. LBP (secondary) amounts are
computed from a frozen tender rate and rounded to whole pounds.
"""
from decimal import Decimal, ROUND_HALF_UP

from .config import MONEY_EPSILON

_CENT = Decimal("0.01")
_WHOLE = Decimal("1")


def round_base_money(value: float | int | str) -> float:
    """Round to 2 decimals, HALF_UP, via Decimal (no float artifacts)."""
    try:
        return float(Decimal(str(value)).quantize(_CENT, rounding=ROUND_HALF_UP))
    except Exception:
        return 0.0


def round_secondary_money(value: float | int | str) -> float:
    """Secondary currency (LBP) rounds to whole units."""
    try:
        return float(Decimal(str(value)).quantize(_WHOLE, rounding=ROUND_HALF_UP))
    except Exception:
        return 0.0


def to_secondary(base_amount: float, rate: float) -> float:
    """Base -> secondary at a frozen rate (rate = secondary per 1 base)."""
    return round_secondary_money(base_amount * rate)


def from_secondary(secondary_amount: float, rate: float) -> float:
    if not rate:
        return 0.0
    return round_base_money(secondary_amount / rate)


def money_eq(a: float, b: float) -> bool:
    return abs(a - b) < MONEY_EPSILON


def money_lte(a: float, b: float) -> bool:
    return a < b + MONEY_EPSILON


def clamp_non_negative(value: float) -> float:
    return value if value > 0 else 0.0
