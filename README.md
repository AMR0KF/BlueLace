# SHOEPOS — offline shoe-store POS & inventory

A parallel rebuild of KHALIFA POS for a shoe store: **Python (FastAPI + SQLite) backend,
React (Vite + TypeScript) frontend**, fully offline/local (single laptop or LAN).
Products are shoe **models** with **color × size variants**; money is dual-currency with
**USD as base** (2 decimals) and **LBP companion** (whole units, frozen rate per transaction).

## Run (development)

```powershell
# 1. API server (port 8899)
cd server
python -m venv .venv          # first time only
.venv\Scripts\pip install -r requirements.txt   # first time only
.venv\Scripts\python run.py

# 2. Web client (port 5174, proxies /api -> 8899)
cd client
npm install                   # first time only
npm run dev
```

Open http://localhost:5174 — first-run login is **admin / PIN 0000**
(change it in Settings; the audit tab nags until you do).

## Run (production / LAN)

```powershell
cd client && npm run build    # builds client/dist
cd ..\server
$env:SHOEPOS_HOST = "0.0.0.0" # or: .venv\Scripts\python run.py --lan
.venv\Scripts\python run.py
```

One process now serves both the API and the app: open `http://<laptop-ip>:8899`
from any tablet on the network. Windows Firewall will ask once — allow it.

## Architecture

- `server/` — FastAPI + stdlib sqlite3 (no ORM), WAL, one global write lock (whole-request
  serialization). ALL business logic is server-side: sales, collections, returns, voids,
  stock accounting, customer balances, money rounding, and a ~10-check audit engine.
- Bootstrap pattern: `GET /api/bootstrap` returns the entire app state; **every mutation
  returns a fresh bootstrap** and the client swaps all in-memory state.
- `client/` — React SPA, no router (section switch), one AppState context.
  Offline: bootstrap cached in localStorage; sales made while the server is down are
  queued and replayed (idempotent by client-generated sale id) via an 8-second health poll.
- Money: stored in USD (base, 2dp, `round_base_money` everywhere); each sale/payment
  freezes `tender_currency` + `tender_rate` so history and receipts never drift.

## Key invariants (do not break)

1. A sale's register payment lives ONLY in `sales.upfront_paid` — never a `payments` row.
2. Collections are cash-only rows grouped as `<groupId>:<n>`; cancel reverses the group.
3. Returns eat the order's open due first; only the excess refunds (cash or store credit).
4. Oversell is allowed (stock goes negative) but flags a review — never block the register.
5. Never hard-delete models/variants with history — deactivate; sale lines freeze labels+cost.

## Backup / restore

Settings → **Download backup** saves a consistent `.db` snapshot.
To restore: stop the server, replace `server/data/shoepos.db` with the backup, start again.

## Data location

`server/data/shoepos.db` (SQLite, WAL mode).
