# Status

The claims pilot is built, from `docs/SPEC.md` and the plan in `docs/PLAN.md`.

## What's built

- `backend/`: FastAPI on SQLite, the system of record.
  - `backend/seed.py` loads UnderCover's records from `data/` and starts every claim as waiting. It never opens `data/evals/` or `data/security/`.
  - The read operations: `list_claims`, `get_claim`, `get_policy` (with the plan's limits and the add-ons), `get_claim_history` (name, customer since and earlier claims, with no contact details) and `list_handlers`.
  - The claim workflow: `start_claim`, `add_step`, `list_steps`, `decide_claim`, `pay_claim` and `sign_off_claim`. A claim moves from waiting to in progress to decided, or to waiting for sign-off when the agent approves more than the payout approval limit in `data/company.json` ($1,000). `pay_claim` refuses with 409 until a handler has signed off such a payout, whoever asks.
  - `backend/instructions.md`: the agent's instructions. `get_instructions` returns them followed by `data/policy_wording.md`, and the dashboard shows the same text.
- `agent/`: the UnderCover Agent, LangChain's `create_agent` on OpenRouter.
  - `run(claim_id, thread_id)` fetches the instructions from the backend, starts the claim, streams the agent and posts each tool call, tool result and message to the backend as a step.
  - Five tools, each wrapping one API operation: `get_claim`, `get_policy`, `get_claim_history`, `decide_claim` and `pay_claim`. A refusal comes back to the model as `Refused: <reason>`.
  - It uses `openai/gpt-6-luna` with low reasoning effort, or `MODEL_NAME` when it's set, such as `openrouter/free`.
- `dashboard/`: React in UnderCover's brand, light and dark following the system setting. It refreshes every 2 seconds.
  - `#/`: the queue, with a count of claims in each state and every claim in queue order.
  - `#/claims/CLM-1001`: a claim in full. Its header, the agent's decision with the reason and policy section, the sign-off and payment, the story, items and documents, the policy and the customer's claim history. The agent's steps appear as it works, with tool results folded and refusals in Raspberry. A claim waiting for sign-off has a choice of handler and **Sign off and pay**, which calls `sign_off_claim` then `pay_claim`.
  - `#/instructions`: the agent's instructions and the policy wording, read only.
- `e2e/`: Playwright tests of the queue, the instructions page, the light and dark backgrounds, the claim page, live steps and the sign-off flow.

## How to run it

- `npm run dev` starts the backend on port 8000 and the dashboard on http://localhost:5173.
- `npm run seed` resets the database, `backend/undercover.db` (or `UNDERCOVER_DB`), from `data/`. The backend also seeds itself at startup when the file doesn't exist.
- `uv run -m agent` works every waiting claim in queue order. `uv run -m agent CLM-1001` works the claims named. Each prints one line: the id, the decision, the payout and the status. A claim that's already decided is left as it was. The agent needs the backend running, and it spends API credit.
- `npm run check` runs every check. Tests never call a model; they use a stub.

The end-to-end tests use their own database. `npm run e2e` starts its own backend on port 8001, with a database seeded fresh in the system temp folder, and its own dashboard on port 5174. It never touches the dev database, so it can run alongside `npm run dev`. The tests that change claims run after the ones that read the seeded queue.

## What the pilot leaves out

- The claims manual, sign-in, real payments and messages to customers, as the spec says.
- Scoring the agent against the handlers' decisions in `data/evals/`. Nothing opens that folder.
- Starting the agent from the dashboard. It runs from the command line.
- A handler rejecting or changing the agent's decision. The spec only asks for sign-off.
- Editing the instructions. They're read only.

## Where the queue stands

Two claims were worked with the real model during the build: CLM-1001 (approved and paid $420.00) and CLM-1004 (approved and paid $74.00). A reseed in between cleared CLM-1001, so the dev database has CLM-1004 decided and the other 24 claims waiting.
