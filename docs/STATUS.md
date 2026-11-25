# Status

The claims pilot, built from `docs/PLAN.md`. Phase 1 of 6 is done.

## What's built

- `backend/`: FastAPI on SQLite. `backend/seed.py` loads UnderCover's records from `data/` (never `data/evals/`) and starts every claim as waiting. The read operations are `list_claims`, `get_claim`, `get_policy`, `get_claim_history` and `list_handlers`, with `health`.
- `agent/`: still the skeleton, `run(claim_id, thread_id)` with one tool that calls the health route.
- `dashboard/`: still the skeleton page that shows whether the backend is up.
- `e2e/`: one test of that page.

## How to run it

- `npm run seed` resets the database, `backend/undercover.db` (or `UNDERCOVER_DB`), from `data/`. The backend also seeds itself at startup when the file doesn't exist.
- `npm run dev` starts the backend on port 8000 and the dashboard on port 5173. `npm run dev:backend` starts the backend alone.
- `npm run check` runs every check.
