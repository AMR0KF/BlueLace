import json

from . import db


def log(conn, user_id: str | None, action: str, entity: str | None = None,
        entity_id: str | None = None, detail: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO audit_logs (id, user_id, action, entity, entity_id, detail, created_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (
            db.new_id("log"),
            user_id,
            action,
            entity,
            entity_id,
            json.dumps(detail, ensure_ascii=False) if detail else None,
            db.now_iso(),
        ),
    )
