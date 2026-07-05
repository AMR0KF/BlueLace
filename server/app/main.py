"""SHOEPOS server: FastAPI app wiring, seeding, error shape, SPA serving."""
import inspect
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from . import auth, db
from .config import CLIENT_DIST
from .routes import (auth_routes, cash, catalog, customers, purchasing, sales,
                     settings_routes)
from .settings import seed_settings


def _seed(conn) -> None:
    seed_settings(conn)
    has_users = conn.execute("SELECT COUNT(*) FROM pos_users").fetchone()[0]
    if not has_users:
        salt = auth.new_salt()
        conn.execute(
            """INSERT INTO pos_users (id, name, role, pin_salt, pin_hash, active,
               is_default_pin, created_at) VALUES (?,?,?,?,?,1,1,?)""",
            ("u-admin", "admin", "admin", salt, auth.hash_pin("0000", salt), db.now_iso()),
        )
    walk_in = conn.execute("SELECT COUNT(*) FROM customers WHERE is_system = 1").fetchone()[0]
    if not walk_in:
        conn.execute(
            """INSERT INTO customers (id, name, phone, credit_limit, store_credit,
               is_system, created_at) VALUES (?,?,?,0,0,1,?)""",
            ("c-walkin", "Walk-in Customer", None, db.now_iso()),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    with db.tx() as conn:
        _seed(conn)
    _assert_sync_handlers(app)
    yield
    db.close_db()


app = FastAPI(title="SHOEPOS", lifespan=lifespan, docs_url=None, redoc_url=None)

for module in (auth_routes, settings_routes, catalog, sales, customers, cash,
               purchasing):
    app.include_router(module.router)


def _assert_sync_handlers(app: FastAPI) -> None:
    """All API handlers must be sync `def` so the global lock fully serializes
    business logic (plan risk: one accidental `async def` weakens the guarantee)."""
    for route in app.routes:
        endpoint = getattr(route, "endpoint", None)
        if endpoint and getattr(route, "path", "").startswith("/api/"):
            if inspect.iscoroutinefunction(endpoint):
                raise RuntimeError(f"Async handler not allowed: {route.path}")


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", [])[1:]) or "payload"
    return JSONResponse(status_code=422,
                        content={"error": f"Invalid {where}: {first.get('msg', 'bad value')}"})


# --- SPA serving (production): any non-/api GET falls through to the built client. ---
@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Unknown API route.")
    if CLIENT_DIST.exists():
        candidate = (CLIENT_DIST / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(CLIENT_DIST.resolve()):
            return FileResponse(candidate)
        index = CLIENT_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
    raise HTTPException(404, "Client build not found — run `npm run build` in client/.")
