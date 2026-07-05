import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
# SHOEPOS_DATA_DIR overrides the data location (tests / secondary installs).
DATA_DIR = Path(os.environ.get("SHOEPOS_DATA_DIR", "") or SERVER_DIR / "data")
DB_PATH = DATA_DIR / "shoepos.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
CLIENT_DIST = SERVER_DIR.parent / "client" / "dist"

# Money: base currency is USD, stored as REAL, always rounded to 2 decimals.
BASE_DECIMALS = 2
MONEY_EPSILON = 0.005

# A whole-cart discount at or above this percentage requires a reason.
LARGE_DISCOUNT_PERCENT = 50

SESSION_DAYS = 30
LOGIN_MAX_ATTEMPTS = 8
LOGIN_WINDOW_SECONDS = 600

# Bootstrap feed caps (mirrors the original's capped feeds).
CAP_STOCK_MOVEMENTS = 300
CAP_CASH_MOVEMENTS = 300
CAP_AUDIT_LOGS = 100
CAP_PURCHASES = 200
