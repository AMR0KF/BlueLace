"""Bootstrap, health, config, settings KV, users admin, backup download."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response

from .. import audit, audit_log, auth, db
from ..auth import require_user
from ..bootstrap import build_bootstrap
from ..schemas import SettingsBody, UserCreateBody, UserPatchBody
from ..settings import get_settings, set_setting, snake

router = APIRouter()


@router.get("/api/config")
def config():
    """Unauthenticated: login-screen branding (ports GET /api/config)."""
    with db.tx() as conn:
        settings = get_settings(conn)
    return {
        "mode": "local",
        "businessName": settings["businessName"],
        "logoUrl": settings.get("logoUrl") or "",
        "baseCurrency": settings["baseCurrency"],
        "secondaryCurrency": settings["secondaryCurrency"],
    }


@router.get("/api/health")
def health():
    """Unauthenticated reachability probe (the client's 8s offline poll)."""
    with db.tx() as conn:
        counts = {
            "models": conn.execute("SELECT COUNT(*) FROM shoe_models").fetchone()[0],
            "sales": conn.execute("SELECT COUNT(*) FROM sales").fetchone()[0],
            "customers": conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
        }
        issues = len(audit.run_checks(conn))
    return {"ok": True, "time": db.now_iso(), "counts": counts, "auditIssues": issues}


@router.get("/api/bootstrap")
def bootstrap(user=Depends(require_user("cashier"))):
    with db.tx() as conn:
        return build_bootstrap(conn, user)


@router.put("/api/settings")
def update_settings(body: SettingsBody, user=Depends(require_user("admin"))):
    provided = body.model_dump(exclude_unset=True, exclude_none=True)
    if not provided:
        raise HTTPException(400, "Nothing to update.")
    with db.tx() as conn:
        for key, value in provided.items():
            set_setting(conn, snake(key), value)
        audit_log.log(conn, user["id"], "settings.update", "settings", None,
                      {"keys": list(provided.keys())})
        return build_bootstrap(conn, user)


@router.post("/api/users")
def create_user(body: UserCreateBody, user=Depends(require_user("admin"))):
    with db.tx() as conn:
        exists = db.one(conn, "SELECT id FROM pos_users WHERE lower(name) = ?",
                        (body.name.strip().lower(),))
        if exists:
            raise HTTPException(400, "That username is taken.")
        salt = auth.new_salt()
        user_id = db.new_id("u")
        conn.execute(
            """INSERT INTO pos_users (id, name, role, pin_salt, pin_hash, active,
               is_default_pin, created_at) VALUES (?,?,?,?,?,1,0,?)""",
            (user_id, body.name.strip(), body.role, salt,
             auth.hash_pin(body.pin, salt), db.now_iso()),
        )
        audit_log.log(conn, user["id"], "user.create", "user", user_id,
                      {"name": body.name, "role": body.role})
        return build_bootstrap(conn, user)


@router.patch("/api/users/{user_id}")
def update_user(user_id: str, body: UserPatchBody, user=Depends(require_user("admin"))):
    with db.tx() as conn:
        target = db.one(conn, "SELECT * FROM pos_users WHERE id = ?", (user_id,))
        if target is None:
            raise HTTPException(404, "User not found.")
        provided = body.model_dump(exclude_unset=True)

        # Never lock the last active admin out.
        demoting = ("role" in provided and body.role != "admin") or \
                   ("active" in provided and body.active is False)
        if target["role"] == "admin" and demoting:
            admins = conn.execute(
                "SELECT COUNT(*) FROM pos_users WHERE role = 'admin' AND active = 1"
            ).fetchone()[0]
            if admins <= 1:
                raise HTTPException(400, "This is the last active admin.")

        if "name" in provided and body.name:
            clash = db.one(conn, "SELECT id FROM pos_users WHERE lower(name) = ? AND id != ?",
                           (body.name.strip().lower(), user_id))
            if clash:
                raise HTTPException(400, "That username is taken.")
            conn.execute("UPDATE pos_users SET name = ? WHERE id = ?",
                         (body.name.strip(), user_id))
        if "role" in provided and body.role:
            conn.execute("UPDATE pos_users SET role = ? WHERE id = ?", (body.role, user_id))
        if "active" in provided and body.active is not None:
            conn.execute("UPDATE pos_users SET active = ? WHERE id = ?",
                         (int(body.active), user_id))
            if body.active is False:
                conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        if "pin" in provided and body.pin:
            salt = auth.new_salt()
            conn.execute(
                "UPDATE pos_users SET pin_salt = ?, pin_hash = ?, is_default_pin = 0 WHERE id = ?",
                (salt, auth.hash_pin(body.pin, salt), user_id))
        audit_log.log(conn, user["id"], "user.update", "user", user_id,
                      {"fields": list(provided.keys()), "name": target["name"]})
        return build_bootstrap(conn, user)


@router.get("/api/backup")
def backup(user=Depends(require_user("admin"))):
    data = db.backup_bytes()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="shoepos-backup-{stamp}.db"'},
    )
