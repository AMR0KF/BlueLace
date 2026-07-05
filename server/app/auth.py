"""PIN auth: PBKDF2-SHA256 (120k iterations, ports local-db-server.mjs:308-314),
bearer tokens stored as SHA-256 hashes, 30-day sessions, login throttling.
"""
import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, Request

from . import db
from .config import LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, SESSION_DAYS

PBKDF2_ITERATIONS = 120_000

ROLE_RANK = {"cashier": 0, "manager": 1, "admin": 2}

# Fixed role -> sections map (per-user allowlist UI is cut in v1; column reserved).
ROLE_SECTIONS = {
    "cashier": ["pos", "orders", "crm"],
    "manager": ["dashboard", "pos", "stock", "purchasing", "crm", "orders",
                 "financial", "reports"],
    "admin": ["dashboard", "pos", "stock", "purchasing", "crm", "orders",
               "financial", "reports", "settings"],
}

_attempts: dict[str, list[float]] = {}


def hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", pin.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS, dklen=32
    ).hex()


def new_salt() -> str:
    return secrets.token_hex(16)


def verify_pin(pin: str, salt: str, expected_hash: str) -> bool:
    return secrets.compare_digest(hash_pin(pin, salt), expected_hash)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def throttle_check(ip: str, username: str) -> None:
    key = f"{ip}|{username.strip().lower()}"
    now = time.monotonic()
    window = [t for t in _attempts.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    _attempts[key] = window
    if len(window) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many login attempts. Try again later.")


def throttle_record(ip: str, username: str) -> None:
    key = f"{ip}|{username.strip().lower()}"
    _attempts.setdefault(key, []).append(time.monotonic())


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "active": bool(row["active"]),
        "isDefaultPin": bool(row.get("isDefaultPin", 0)),
        "sections": ROLE_SECTIONS.get(row["role"], []),
    }


def create_session(conn, user_id: str) -> str:
    token = secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    conn.execute(
        "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
        (token_hash(token), user_id, db.now_iso(),
         expires.isoformat(timespec="milliseconds").replace("+00:00", "Z")),
    )
    conn.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (db.now_iso(),))
    return token


def resolve_token(authorization: str | None) -> dict:
    """Resolve a bearer token to an active user. Runs its own short tx —
    handlers open their own tx afterwards (the lock is not reentrant)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Not signed in.")
    token = authorization[7:].strip()
    with db.tx() as conn:
        row = db.one(
            conn,
            """SELECT u.id, u.name, u.role, u.active, u.is_default_pin, s.expires_at
               FROM auth_sessions s JOIN pos_users u ON u.id = s.user_id
               WHERE s.token_hash = ?""",
            (token_hash(token),),
        )
    if row is None or row["expiresAt"] < db.now_iso():
        raise HTTPException(401, "Session expired. Sign in again.")
    if not row["active"]:
        raise HTTPException(401, "This user is disabled.")
    return {"id": row["id"], "name": row["name"], "role": row["role"]}


def require_user(min_role: str = "cashier"):
    """FastAPI dependency factory: require_user('manager') etc."""

    def dependency(request: Request, authorization: str | None = Header(default=None)) -> dict:
        user = resolve_token(authorization)
        if ROLE_RANK[user["role"]] < ROLE_RANK[min_role]:
            raise HTTPException(403, "You don't have permission for this action.")
        return user

    return dependency
