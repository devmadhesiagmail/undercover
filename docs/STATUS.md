# Status

The claims pilot, built from `docs/PLAN.md`. Phases 1 to 3 of 6 are done.

## What's built

- `backend/`: FastAPI on SQLite. `backend/seed.py` loads UnderCover's records from `data/` (never `data/evals/`) and starts every claim as waiting. The read operations are `list_claims`, `get_claim`, `get_policy`, `get_claim_history` and `list_handlers`, with `health`.
- The claim workflow: `start_claim`, `add_step`, `list_steps`, `decide_claim`, `pay_claim` and `sign_off_claim`. A claim moves from waiting to in progress to decided, or to waiting for sign-off when the agent approves more than the payout approval limit in `data/company.json` ($1,000). `pay_claim` refuses with 409 until a handler has signed off such a payout.
- `backend/instructions.md`: the agent's instructions. `get_instructions` returns them followed by `data/policy_wording.md`.
- `agent/`: the UnderCover Agent, LangChain's `create_agent` on OpenRouter. `run(claim_id, thread_id)` fetches the instructions from the backend, starts the claim, streams the agent and posts each tool call, tool result and message as a step. Its five tools each wrap one API operation: `get_claim`, `get_policy`, `get_claim_history`, `decide_claim` and `pay_claim`. A refusal comes back to the model as `Refused: <reason>`. It uses `openai/gpt-6-luna` with low reasoning effort, or `MODEL_NAME` when it's set.
- `dashboard/`: still the skeleton page that shows whether the backend is up.
- `e2e/`: one test of that page.

## How to run it

- `npm run seed` resets the database, `backend/undercover.db` (or `UNDERCOVER_DB`), from `data/`. The backend also seeds itself at startup when the file doesn't exist.
- `npm run dev` starts the backend on port 8000 and the dashboard on port 5173. `npm run dev:backend` starts the backend alone.
- `uv run -m agent` works every waiting claim in queue order, and `uv run -m agent CLM-1001` works the claims named. Each prints one line: the id, the decision, the payout and the status. The agent needs the backend running, and it spends API credit.
- `npm run check` runs every check. Tests never call a model; they use a stub.
