"""SHOEPOS local server entrypoint.

Run:  python run.py
LAN:  set SHOEPOS_HOST=0.0.0.0 first (or pass --lan), then open http://<laptop-ip>:8899

Port 8899 by default — KHALIFA POS already occupies 8787 on this machine, and a
0.0.0.0 listener coexists silently with a 127.0.0.1 one on Windows (traffic falls
through to the other app when one dies). Do not move SHOEPOS back to 8787.
"""
import os
import sys

import uvicorn


def main() -> None:
    host = os.environ.get("SHOEPOS_HOST", "127.0.0.1")
    if "--lan" in sys.argv:
        host = "0.0.0.0"
    port = int(os.environ.get("SHOEPOS_PORT", "8899"))
    uvicorn.run("app.main:app", host=host, port=port, workers=1, log_level="info")


if __name__ == "__main__":
    main()
