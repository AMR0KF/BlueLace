# Kickoff prompt for the Opus EXE-packaging session

The full plan lives in [`EXE_PACKAGING_PLAN.md`](EXE_PACKAGING_PLAN.md) — this file is
just the prompt to paste into a **fresh Opus session** opened in `SHOEPOS/`.

---

## Paste this:

```text
Read .planning/EXE_PACKAGING_PLAN.md and execute it end to end. It packages this
FastAPI + SQLite + React POS into a Windows EXE with PyInstaller (onedir).

Rules of engagement:
- The plan's §0 decisions are final — do not re-litigate PyInstaller/onedir/console/data-dir.
- Wave 1: launch TWO parallel subagents exactly as specified — Track A edits ONLY
  server/app/config.py and server/run.py; Track B creates ONLY packaging/shoepos.spec,
  scripts/build-exe.ps1, optional packaging/icon.ico, and the README "Build the EXE"
  section. Disjoint files, no overlap. Sonnet/Opus-tier subagents only.
- Wave 2 you do yourself, sequentially: run scripts\build-exe.ps1, then smoke-test the
  exe with an isolated data dir (SHOEPOS_DATA_DIR=%TEMP%\shoepos-smoke): GET / serves
  the SPA, login admin/0000 works, /api/bootstrap returns state, shoepos.db appears in
  the smoke dir. Then re-verify dev mode (python run.py + npm run dev) still works.
- If the first build fails, diagnose the actual error before changing anything —
  no stacked guesses. Fix in the spec/config, never with sys.path hacks.
- Do NOT run any git commands (no add/commit/push). I handle git myself.
- Definition of done: I can double-click build\SHOEPOS\SHOEPOS.exe on this machine,
  the browser opens, and I can log in and ring a sale. Report every §5 checklist item
  as checked or explicitly not-checked. No "should work" — only what you observed.
- When everything passes, create .claude/skills/build-exe/SKILL.md capturing the exact
  build + smoke-test procedure, and update the plan's Status log.
```

---

**Before starting the Opus session (optional but recommended):** run
`/fewer-permission-prompts` so `npm`, `pip`, and `pyinstaller` don't prompt repeatedly.
