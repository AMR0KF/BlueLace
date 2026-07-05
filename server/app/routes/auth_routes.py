from fastapi import APIRouter, Header, HTTPException, Request

from .. import auth, db
from ..audit_log import log
from ..bootstrap import build_bootstrap
from ..schemas import LoginBody

router = APIRouter()


@router.post("/api/auth/login")
def login(body: LoginBody, request: Request):
    ip = request.client.host if request.client else "?"
    auth.throttle_check(ip, body.username)
    with db.tx() as conn:
        row = db.one(conn, "SELECT * FROM pos_users WHERE lower(name) = ?",
                     (body.username.strip().lower(),))
        if row is None or not row["active"] or not auth.verify_pin(
                body.pin, row["pinSalt"], row["pinHash"]):
            auth.throttle_record(ip, body.username)
            raise HTTPException(401, "Wrong username or PIN.")
        token = auth.create_session(conn, row["id"])
        user = {"id": row["id"], "name": row["name"], "role": row["role"]}
        log(conn, row["id"], "auth.login", "user", row["id"], None)
        return {"token": token, "user": auth.public_user(row),
                "bootstrap": build_bootstrap(conn, user)}


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        with db.tx() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?",
                         (auth.token_hash(token),))
    return {"ok": True}


@router.get("/api/auth/session")
def session(authorization: str | None = Header(default=None)):
    user = auth.resolve_token(authorization)
    return {"user": {**user, "sections": auth.ROLE_SECTIONS.get(user["role"], [])}}
