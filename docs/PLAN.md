# Plan: the claims pilot

Built from `docs/SPEC.md`, with the stack in `docs/TECH_STACK.md`, the standards in `docs/CODE_STANDARDS.md`, the process in `docs/PROCESS.md` and the look in `docs/BRAND.md`.

## What we are building

Three parts. The agent and the dashboard reach the business data only through the backend's API.

```
uv run -m agent [CLM-...]
        |
        v
  agent.run(claim_id, thread_id)          dashboard (React)
   tools: get_claim, get_policy,          queue, claim in full, live steps,
          get_claim_history,              instructions, sign-off
          decide_claim, pay_claim         polls every 2 seconds
   steps: posted by run() itself                 |
        |                                        |
        +-------------> backend (FastAPI) <------+
                              |
                           SQLite  <-- seeded from data/ (never data/evals/)
```

- **Backend:** the system of record. It holds the queue, policies, customers, plans and handlers, moves each claim through its states and enforces the payment rule.
- **Agent:** works one claim at a time. It reads the claim, the policy and the customer's claim history, decides from the policy wording, records the decision and tries to pay. Every step it takes is posted to the backend.
- **Dashboard:** the queue with each claim's state, each claim in full with the agent's decision and reasons, the agent's steps as they happen, the agent's instructions (read only), and the handler's sign-off.

## Before implementing

These are fixes to the setup on this machine. They aren't part of the build.

1. **Node.** This Mac has Node v19.7.0 from Homebrew. The repo needs v24 or later (`.nvmrc` says 26 and `.npmrc` sets `engine-strict`). Run `brew upgrade node`, or install the LTS from nodejs.org, then `npm install` at the repo root. That installs the dashboard packages, the pre-commit hook and Playwright's Chromium.
2. **Playwright MCP server.** The success criteria check pages in the browser through it. Run `claude mcp add playwright -- npx -y @playwright/mcp@latest`, then restart Claude Code and check it with `claude mcp list`. It needs Google Chrome.
3. **API spend.** Two success criteria run the real agent on one claim each (CLM-1001 in Phase 3, CLM-1004 in Phase 6). Nothing else calls a model. `MODEL_NAME` isn't set in `.env`, so those two runs use `openai/gpt-6-luna`. To use the free route instead, set `MODEL_NAME=openrouter/free`.

## Decisions, and why

1. **SQLite through Python's built-in `sqlite3`, not SQLAlchemy.** We need a handful of tables, and SQLAlchemy isn't in the default install. Each record from `data/` is stored whole as JSON, with the workflow columns (status, decision, sign-off, payment) beside it, so UnderCover's records stay as they wrote them. Each request opens its own connection.
2. **The backend enforces the payment rule.** The spec says the system must block an over-limit payment "even if the agent tries to pay". So the rule lives in the backend's `pay_claim` operation, not in the agent's instructions. The agent is told to pay after every approval, and the backend refuses until a handler has signed off. No prompt, model error or dashboard bug can get round it. The $1,000 limit is read from `payout_approval_limit` in `data/company.json`, not hard-coded.
3. **The instructions live in the backend.** The agent's instructions are in `backend/instructions.md`. `GET /api/instructions` returns them with the policy wording appended. The agent fetches them at the start of every run, and the dashboard shows the same text. This meets the tech stack's rule that the agent reaches its instructions only through the API, and handlers see exactly what the agent sees. The wording goes in the instructions rather than behind a tool because it's short, every claim needs it, and the model can't skip reading it.
4. **Tools return refusals as text.** LangChain's tool node re-raises any tool error other than bad arguments, which would end the run. So each tool returns the backend's JSON on success and `Refused: <reason>` on a 4xx response. That way the agent reads why the payment was blocked and finishes the claim.
5. **`run()` posts the steps, not the model.** It streams the agent and posts each tool call, tool result and message to the backend. The model has no logging tool, so it can't skip or misreport a step.
6. **Least personal data.** The agent and the dashboard get the customer's name, how long they've been a customer and their earlier claims. Contact details, date of birth and address are never served. The spec needs only the claim history.
7. **Queue order is claim id order.** That's the order of `data/claims.json`, the queue as UnderCover gave it to us. Ordering by oldest submission first instead is a one-line change.
8. **The dashboard polls.** It refetches every 2 seconds. That's live enough for watching the agent work, and simpler than websockets or server-sent events.
9. **The end-to-end tests get their own backend and database.** Playwright starts its own backend on port 8001, with a new SQLite file each run, and its own dashboard on port 5174. Then `npm run check` never wipes the decisions in the dev database, which cost API credit, and every test starts from the seeded state.
10. **Hash routing, with no router library.** There are three pages: `#/` for the queue, `#/claims/CLM-1001` for a claim and `#/instructions`. Links and the back button work.

## The claim lifecycle

```
waiting --start_claim--> in_progress --decide_claim--> decided               decline, refer, or approve up to $1,000
                                      \-decide_claim--> waiting_for_sign_off  approve over $1,000
                                                              |
                                                       sign_off_claim (a handler)
                                                              v
                                                           decided
```

- `start_claim` works on a claim that's waiting or in progress, so a run that crashed can be restarted by claim id. It's refused once the claim is waiting for sign-off or decided.
- `decide_claim` works only on a claim in progress, and only once. An approval needs a payout above zero. A decline or a referral has a payout of zero.
- `pay_claim(amount)` pays only when the decision is approve, the amount equals the approved payout, the claim hasn't been paid, and either the payout is $1,000 or less or a handler has signed off. Otherwise it's refused with HTTP 409 and a plain-English reason.
- `sign_off_claim(handler_id)` works only on a claim waiting for sign-off, by a handler who may approve over the limit.
- On the dashboard, a claim waiting for sign-off shows **Sign off and pay $1,150.00** and a choice of handler. The button calls `sign_off_claim` and then `pay_claim`.

## The API

Every operation has an `operation_id` and a one-line docstring, and every input is required. Unknown ids return 404. A step the claim's state doesn't allow returns 409 with a `detail` that says why. An invalid body returns 422.

| Method and path | operation_id | Used by | Returns or does |
|---|---|---|---|
| `GET /api/health` | `health` | checks | Already built |
| `GET /api/claims` | `list_claims` | dashboard, agent CLI | The queue in order: id, customer name, type, submitted date, amount claimed, status, decision and payout |
| `GET /api/claims/{claim_id}` | `get_claim` | agent, dashboard | The claim in full, with its status, decision, sign-off and payment |
| `GET /api/policies/{policy_id}` | `get_policy` | agent, dashboard | The policy with its plan's limits |
| `GET /api/customers/{customer_id}/history` | `get_claim_history` | agent, dashboard | Name, customer since, earlier claims |
| `GET /api/handlers` | `list_handlers` | dashboard | The three handlers, for sign-off |
| `GET /api/instructions` | `get_instructions` | agent, dashboard | The instructions followed by the policy wording |
| `POST /api/claims/{claim_id}/start` | `start_claim` | `run()` | `{thread_id}`: moves the claim to in progress and records a start step |
| `POST /api/claims/{claim_id}/steps` | `add_step` | `run()` | `{thread_id, kind, detail}`, where kind is `call`, `result` or `message` |
| `GET /api/claims/{claim_id}/steps` | `list_steps` | dashboard | The claim's steps, oldest first |
| `POST /api/claims/{claim_id}/decision` | `decide_claim` | agent tool | `{decision, payout, reason, policy_section}` |
| `POST /api/claims/{claim_id}/payment` | `pay_claim` | agent tool, dashboard | `{amount}` |
| `POST /api/claims/{claim_id}/sign-off` | `sign_off_claim` | dashboard | `{handler_id}` |

`get_claim` returns the record from `data/claims.json` with `customer_name` and `status` added. It also adds three fields that are null until they apply:

- `decision`: `{decision, payout, reason, policy_section, decided_at}`
- `sign_off`: `{handler_id, handler_name, signed_off_at}`
- `payment`: `{amount, paid_at}`

Times are UTC ISO 8601.

## Files

- `backend/db.py`: the connection and schema. The database file is `UNDERCOVER_DB`, by default `backend/undercover.db`, which `*.db` in `.gitignore` already covers.
- `backend/seed.py`: `uv run -m backend.seed` resets the database from `data/`.
- `backend/main.py`: the API.
- `backend/instructions.md`: the agent's instructions.
- `agent/main.py`: the tools, the model and `run(claim_id, thread_id)`.
- `agent/__main__.py`: the command line.
- `dashboard/src/`: `api.ts` (types and fetch calls), `format.ts` (money and dates), `App.tsx` (layout and routing), `Queue.tsx`, `ClaimPage.tsx`, `Steps.tsx`, `SignOff.tsx`, `Instructions.tsx`, `StatusBadge.tsx`, `styles.css`, each with its tests.
- `e2e/`: `queue.spec.ts`, `claim.spec.ts`, `instructions.spec.ts` and `theme.spec.ts`, which replace `health.spec.ts`.
- Changed: `package.json` (adds `npm run seed`), `playwright.config.ts` (its own backend and dashboard), `dashboard/vite.config.ts` (proxy target from `BACKEND_URL`, by default port 8000) and `dashboard/index.html` (fonts).

## How each phase ends

Each phase is built with its tests. Then every criterion is checked and anything that fails is fixed. Then the criteria are ticked here, `docs/STATUS.md` is updated and the phase is committed; the pre-commit hook runs the checks. Tests never call a model; they use a stub model. Commands are written for this Mac.

---

## Phase 1: The backend's data and read API

**Builds:**

- The SQLite schema.
- The seed. It loads `company.json`, `plans.json`, `handlers.json`, `policies.json`, `customers.json` and `claims.json` by name, never `data/evals/` or `data/security/`, and every claim starts as waiting. `npm run seed` resets the database, and the backend seeds itself at startup when the database file doesn't exist.
- The read operations: `list_claims`, `get_claim`, `get_policy`, `get_claim_history` and `list_handlers`.

**Why first:** the agent and the dashboard both read from it, and it can be checked against `data/` with curl before anything is built on top.

- [x] `uv run pytest backend -q` passes. Each test gets its own temporary database, and the tests cover the seed counts, each read operation and 404s for unknown ids.
- [x] `npm run seed` reports 25 claims, 50 policies, 49 customers, 3 plans and 3 handlers.
- [x] With `npm run dev:backend` running, `curl -s localhost:8000/api/claims` returns 25 claims from CLM-1001 to CLM-1025, all with `"status": "waiting"`. CLM-1001's customer is Maya Patel.
- [x] `curl -s localhost:8000/api/claims/CLM-1001` returns the story, 3 items, 4 documents and `"decision": null`.
- [x] `curl -s localhost:8000/api/policies/POL-2001` returns the Premium plan with its limits: a $300 per-item limit and a $50 deductible.
- [x] `curl -s localhost:8000/api/customers/CUS-3001/history` returns Maya Patel with one earlier claim, CLM-0412, and no email, phone, date of birth or address.
- [x] `curl -s -o /dev/null -w "%{http_code}" localhost:8000/api/claims/CLM-9999` prints `404`.
- [x] `git grep -n "evals" -- backend agent` prints nothing.
- [x] `npm run check:python` passes: ruff, pyright, and pytest with at least 80% coverage.

## Phase 2: The claim workflow and the payment rule

**Builds:**

- The steps table.
- The workflow operations: `start_claim`, `add_step`, `list_steps`, `decide_claim`, `pay_claim` and `sign_off_claim`.
- The state changes and refusals listed under "The claim lifecycle".

**Why second:** the business rules belong in the backend, where no agent or screen can get round them. Building them before the agent means they're tested on their own, without a model.

- [x] pytest covers every state change and every refusal:
  - [x] `start_claim` moves a waiting claim to in progress and records a start step. It can restart a claim in progress, and it's refused with 409 on a decided claim.
  - [x] `decide_claim`: approving $420 leaves the claim decided, and approving $1,150 leaves it waiting for sign-off. A decline and a referral are decided with a payout of zero. A second decision is refused with 409. An approval with a zero payout, or a decline with a payout, is refused with 422.
  - [x] `pay_claim` pays an approved $420. It refuses with 409 for a declined or referred claim, for an amount other than the payout, and for a second payment. It refuses to pay $1,150 before sign-off and records no payment. After sign-off it pays.
  - [x] `sign_off_claim` works only on a claim waiting for sign-off. It records the handler and the time and moves the claim to decided. An unknown handler returns 404.
  - [x] The limit comes from the company settings: a test that raises it in the test database lets a $1,150 payment through without sign-off.
  - [x] Steps come back in order, each with its thread id, kind, detail and time.
- [x] A walk-through with curl against the dev backend:
  - [x] Start CLM-1002 and record an approval of $1,150. The claim is `waiting_for_sign_off`.
  - [x] Paying $1,150 returns 409, with a detail saying a payout over $1,000 needs a handler's sign-off, and `GET /api/claims/CLM-1002` still shows `"payment": null`.
  - [x] Signing off as HND-01 moves the claim to `decided`, signed off by Dana Whitfield.
  - [x] Paying $1,150 now returns 200 and records the payment, and paying again returns 409.
  - [x] Then `npm run seed` restores the seeded state.
- [x] `npm run check:python` passes.

## Phase 3: The UnderCover Agent

**Builds:**

- `backend/instructions.md` and the `get_instructions` operation.
- The agent's five tools. Each wraps one API operation and returns the JSON, or `Refused: <reason>` on a 4xx. They replace `check_backend`.
- `run(claim_id, thread_id)`. It fetches the instructions, starts the claim, streams the agent, posts each step and returns the final reply.
- The command line. `uv run -m agent` works every waiting claim in queue order, and `uv run -m agent CLM-1001` works the named claims. It prints one line per claim: the id, the decision, the payout and the status. A claim the backend won't start, such as one already decided, prints the backend's reason and is left as it was.

**The instructions:**

- Work one claim. Read the claim, the policy and the customer's claim history, and decide from the policy wording that follows, nothing else.
- Work out an approval's payout as section 10 of the wording says: the eligible amount of each item, capped at the per-item limit for belongings; less what a carrier or anyone else has paid; less the deductible once per claim where it applies; capped at the benefit's maximum.
- Refer a claim when a document the wording requires is missing, or when the facts conflict or need a person's judgment.
- Record the decision with `decide_claim`. Give the reason in two or three plain sentences, and the relevant section by number and name, such as "Section 3, Trip Delay".
- After an approval, pay the payout with `pay_claim`. A payout over $1,000 is refused until a handler signs off, and that's expected.
- Amounts are in US dollars.

**Why:** this is the pilot's purpose. The tests drive the agent with a scripted stub model, so every path is checked without spending anything. One live run then proves the wiring to OpenRouter.

- [x] pytest passes with a stub model, and covers:
  - [x] The agent has exactly the five tools, and none reads a file.
  - [x] Each tool calls its operation, and a refusal comes back as text.
  - [x] The system prompt the model receives is the text from `GET /api/instructions`.
  - [x] A scripted run on CLM-1001 reads the claim, the policy and the history, approves $420 and pays. The claim ends decided and paid $420, and its steps are recorded in order: start, calls, results, message.
  - [x] A scripted run on CLM-1002 approves $1,150 and tries to pay. The claim ends waiting for sign-off with no payment, and the pay step's result says it was refused.
  - [x] A scripted decline and a scripted referral each end decided with no payment.
  - [x] With no arguments, the command line works only the waiting claims, in queue order. With ids, it works those claims.
  - [x] `model()` uses `openai/gpt-6-luna` with low reasoning effort, or `MODEL_NAME` when it's set.
- [x] `curl -s localhost:8000/api/instructions` returns the instructions followed by the policy wording, including "Version 2026.1".
- [x] Live check, the only model spend in this phase: with the backend running, `uv run -m agent CLM-1001` prints a line for CLM-1001 with a decision.
  - [x] `GET /api/claims/CLM-1001` shows status `decided` or `waiting_for_sign_off`, a reason of two or three sentences and a policy section.
  - [x] `GET /api/claims/CLM-1001/steps` shows the reads of the claim, the policy and the history, then the decision.
  - This checks that the agent works the claim end to end. It doesn't check that the decision is right; that's what the handlers' decisions in `data/evals/` are for, in a later build.
- [x] Running `uv run -m agent CLM-1001` again prints that the claim is already decided and changes nothing.
- [x] `npm run check:python` passes.

## Phase 4: The dashboard's brand, queue and instructions

**Builds:**

- **The brand.** Instrument Sans, Instrument Serif and JetBrains Mono from Google Fonts. The colors and surfaces from `docs/BRAND.md`, in light and dark mode following the system setting. Rounded panels with no outline.
- **Status colors.** Decided is Sea Green, In progress is Marigold and Waiting for sign-off is Coral, all with Midnight text. Waiting is Cerulean with white text. Raspberry is kept for refusals.
- **The layout.** A header with UnderCover and links to Queue and Instructions, and hash routing.
- **The queue page.** A count of claims in each state, then a table in queue order: claim id, customer, type, submitted date, amount claimed, status, and decision with payout. Ids and amounts are in JetBrains Mono, and money is formatted like $1,250.00. Each row opens the claim. The page refreshes every 2 seconds.
- **The instructions page.** The text, marked read only.
- **A placeholder claim page,** which Phase 5 fills in.
- **The end-to-end setup.** Playwright runs its own backend and dashboard, as in decision 9. The old health test is replaced.

**Why:** the queue is the handlers' home page, and the brand and end-to-end setup that every later page relies on go in here.

- [ ] vitest covers the queue (rows, counts and labels from a stubbed API), money formatting, the instructions page and routing, with at least 80% statement coverage.
- [ ] The Playwright tests pass:
  - [ ] The queue shows 25 claims with CLM-1001 first, all Waiting.
  - [ ] Clicking CLM-1001 opens `#/claims/CLM-1001`.
  - [ ] The instructions page shows the policy wording.
  - [ ] The page background is `rgb(240, 244, 245)` in light mode and `rgb(4, 35, 46)` in dark mode.
- [ ] With `npm run dev` also running, `npm run e2e` passes and leaves the dev database's claims unchanged; this is checked with curl on port 8000 before and after.
- [ ] In the browser, through the Playwright MCP server at http://localhost:5173:
  - [ ] Set CLM-1002 to waiting for sign-off through the API.
  - [ ] The queue shows the counts and each status in its color: CLM-1001 with its decision from Phase 3, CLM-1002 waiting for sign-off, and the others waiting.
  - [ ] Headings are in Instrument Sans and ids in JetBrains Mono, panels have no outline, and there are no one-edge borders.
  - [ ] The instructions page reads cleanly.
  - [ ] The console shows no errors.
  - [ ] Then `npm run seed`.
- [ ] `npm run check:ts` passes: Prettier, ESLint, tsc in strict mode with no `any`, and vitest with at least 80% coverage.

## Phase 5: The claim in full, live steps and sign-off

**Builds:** the claim page.

- **Header:** id, status, summary, customer, submitted date, incident date and place, amount claimed.
- **The agent's decision:** the decision, the payout, the reason and the policy section, then the sign-off and payment state. Before the agent has decided, it shows "No decision yet".
- **Sign-off,** when the claim is waiting for sign-off: a choice of handler and **Sign off and pay $X**, which calls `sign_off_claim` then `pay_claim` and shows any refusal.
- **The claim:** the story, the items with their amounts, and each document with its name, type and text.
- **The policy:** plan, add-ons, purchase date, trip dates and destination, trip cost and travelers.
- **The customer:** name, customer since, and earlier claims with their outcomes.
- **The agent's steps,** oldest first and refreshed every 2 seconds. Tool results are folded by default, and refusals are marked in Raspberry.

**Why:** this is where a handler checks the agent's work and releases over-limit payments. It's also where the spec's "what the agent is doing, step by step" is seen.

- [ ] vitest covers each section from a stubbed API, "No decision yet", each kind of step, and sign-off calling `sign_off_claim` then `pay_claim` with the chosen handler and the payout. An error shows when a call is refused.
- [ ] The Playwright tests pass. They set up their claims through the API, with no model:
  - [ ] CLM-1003's page shows the story, the items, the documents, the policy and the claim history.
  - [ ] A step posted through the API while CLM-1005's page is open appears within 5 seconds, without a reload.
  - [ ] The sign-off flow:
    - [ ] CLM-1002 is put into waiting for sign-off through the API, with a pay attempt that's refused.
    - [ ] The page shows Waiting for sign-off and the refused step.
    - [ ] Choosing Dana Whitfield and clicking **Sign off and pay $1,150.00** leaves the page showing Decided, "Signed off by Dana Whitfield" and "Paid $1,150.00".
    - [ ] The queue then shows CLM-1002 as Decided.
- [ ] In the browser, through the Playwright MCP server on the dev server:
  - [ ] Set CLM-1002 to waiting for sign-off through the API.
  - [ ] The claim page is laid out cleanly in light mode, and the sign-off panel works.
  - [ ] The console shows no errors.
  - [ ] Then `npm run seed`.
- [ ] `npm run check:ts` passes.

## Phase 6: The live check and hand-over

**Builds:** nothing new, unless a check finds a problem. This phase runs the whole product with a real model and leaves the documentation ready for the next build.

**Why:** every earlier check used a stub or set claims up through the API. This one watches the real agent work a claim on the dashboard, as a handler would.

- [ ] With `npm run dev` running and CLM-1004's page open through the Playwright MCP server, `uv run -m agent CLM-1004` runs. This is the second and last live claim.
  - [ ] The page shows the claim In progress.
  - [ ] Its steps appear while the agent works.
  - [ ] It ends with the agent's decision, reason and policy section.
- [ ] The queue shows CLM-1004 with its decision and the other 24 claims waiting.
- [ ] `docs/STATUS.md` says:
  - [ ] What's built.
  - [ ] How to run it: `npm run dev`, `npm run seed`, `uv run -m agent` and `uv run -m agent CLM-1001`. The agent needs the backend running.
  - [ ] That the end-to-end tests use their own database.
  - [ ] What the pilot leaves out.
- [ ] `npm run check` passes in full, and the results are reported.

---

## Not in the pilot

- The claims manual, sign-in, real payments and messages to customers, as the spec says.
- Scoring the agent against the handlers' decisions in `data/evals/`. Nothing in this build opens that folder.
- Starting the agent from the dashboard. The spec asks to see the agent's work, so it runs from the command line.
- A handler rejecting or changing the agent's decision, including an over-limit approval. The spec only asks for sign-off. This is a question worth taking back to the head of claims.
- Editing the instructions. They're read only, as the spec says.

## After the build

`uv run -m agent` works the remaining 24 claims in the queue. It uses the model in `MODEL_NAME`, or `openai/gpt-6-luna`, so it spends API credit. `npm run seed` starts the queue again from `data/`.
