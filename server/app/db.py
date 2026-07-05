"""SQLite connection, global write lock, and transaction context.

Ports the original's whole-request serialization (withRequestLock,
local-db-server.mjs:4074): one connection, one threading.Lock, every handler body
runs inside db.tx(). Handlers are synchronous `def` routes so FastAPI runs them in
the threadpool and the lock provides strict serialization.
"""
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DATA_DIR, DB_PATH, SCHEMA_PATH

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def open_db() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _migrate(conn)
    conn.commit()
    _conn = conn
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Additive migrations for DBs created before a schema change. schema.sql uses
    CREATE TABLE IF NOT EXISTS, so new columns on existing tables must be added here.
    Every entry must be idempotent-by-check; runs on every boot."""
    def columns(table: str) -> set[str]:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}

    if "color_images" not in columns("shoe_models"):
        conn.execute("ALTER TABLE shoe_models ADD COLUMN color_images TEXT")
    if "ref_purchase_id" not in columns("stock_movements"):
        conn.execute("ALTER TABLE stock_movements ADD COLUMN ref_purchase_id TEXT")


def close_db() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


@contextmanager
def tx():
    """Serialized transaction over the single connection.

    Reads use it too (bootstrap must not observe mid-transaction state).
    """
    conn = open_db()
    with _lock:
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def backup_bytes() -> bytes:
    """Consistent snapshot of the whole DB (sqlite3 backup API, safe under WAL)."""
    import os
    import tempfile
    from pathlib import Path

    conn = open_db()
    with _lock:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            dest = sqlite3.connect(path)
            try:
                conn.backup(dest)
            finally:
                dest.close()
            return Path(path).read_bytes()
        finally:
            os.unlink(path)


_CAMEL_RE = re.compile(r"_([a-z0-9])")


def _camel(key: str) -> str:
    return _CAMEL_RE.sub(lambda m: m.group(1).upper(), key)


def row_dict(row: sqlite3.Row) -> dict:
    """sqlite Row -> camelCase dict for JSON payloads."""
    return {_camel(k): row[k] for k in row.keys()}


def rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [row_dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict | None:
    r = conn.execute(sql, params).fetchone()
    return row_dict(r) if r is not None else None
