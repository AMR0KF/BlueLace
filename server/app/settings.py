"""app_settings KV access. Base currency is USD (2dp); secondary LBP (whole units).
exchange_rate = secondary per 1 base (LBP per USD, e.g. 89500).
"""
from . import db

DEFAULTS: dict[str, str] = {
    "base_currency": "USD",
    "secondary_currency": "LBP",
    "exchange_rate": "89500",
    "tax_rate": "0",
    "lbp_display_rounding": "1000",   # cosmetic grouping for LBP display
    "business_name": "Shoe Store",
    "business_tagline": "",
    "business_phone": "",
    "business_address": "",
    "receipt_footer": "Thank you for your visit!",
    "logo_url": "",
}

NUMERIC_KEYS = {"exchange_rate", "tax_rate", "lbp_display_rounding"}


def seed_settings(conn) -> None:
    for key, value in DEFAULTS.items():
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?,?,?)",
            (key, value, db.now_iso()),
        )


def get_settings(conn) -> dict:
    out: dict = {}
    for row in conn.execute("SELECT key, value FROM app_settings"):
        key, value = row["key"], row["value"]
        if key in NUMERIC_KEYS:
            try:
                out[_camel(key)] = float(value)
            except ValueError:
                out[_camel(key)] = 0.0
        else:
            out[_camel(key)] = value
    return out


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, str(value), db.now_iso()),
    )


def _camel(key: str) -> str:
    parts = key.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def snake(camel_key: str) -> str:
    out = []
    for ch in camel_key:
        if ch.isupper():
            out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)
