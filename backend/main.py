"""The UnderCover backend."""

import json
import sqlite3
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Self

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator

from backend import db
from backend.seed import seed

CLAIMS_QUERY = """
SELECT claims.*, json_extract(customers.record, '$.name') AS customer_name
FROM claims
JOIN customers ON customers.customer_id = json_extract(claims.record, '$.customer_id')
ORDER BY claims.claim_id
"""

CLAIM_QUERY = """
SELECT claims.*, json_extract(customers.record, '$.name') AS customer_name
FROM claims
JOIN customers ON customers.customer_id = json_extract(claims.record, '$.customer_id')
WHERE claims.claim_id = ?
"""

STATUS_TEXT = {
    "waiting": "waiting",
    "in_progress": "in progress",
    "waiting_for_sign_off": "waiting for sign-off",
    "decided": "decided",
}

DECIDED_TEXT = {"approve": "approved", "decline": "declined", "refer": "referred"}


class Start(BaseModel):
    """The agent's thread working the claim."""

    thread_id: str = Field(min_length=1)


class Step(BaseModel):
    """One thing the agent did on a claim."""

    thread_id: str = Field(min_length=1)
    kind: Literal["call", "result", "message"]
    detail: str


class Decision(BaseModel):
    """The agent's decision on a claim."""

    decision: Literal["approve", "decline", "refer"]
    payout: float = Field(ge=0)
    reason: str = Field(min_length=1)
    policy_section: str = Field(min_length=1)

    @model_validator(mode="after")
    def payout_fits_decision(self) -> Self:
        """An approval pays something, and a decline or a referral pays nothing."""
        if self.decision == "approve" and self.payout == 0:
            raise ValueError("An approval needs a payout above zero")
        if self.decision != "approve" and self.payout != 0:
            raise ValueError("A decline or a referral has a payout of zero")
        return self


class Payment(BaseModel):
    """An amount to pay on an approved claim."""

    amount: float = Field(gt=0)


class SignOff(BaseModel):
    """The handler signing off a payout over the limit."""

    handler_id: str


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Seed the database from data/ when it doesn't exist yet."""
    if not db.path().exists():
        seed()
    yield


app = FastAPI(title="UnderCover", lifespan=lifespan)


def database() -> Iterator[sqlite3.Connection]:
    """Open a connection for one request."""
    with closing(db.connect()) as conn:
        yield conn


Database = Annotated[sqlite3.Connection, Depends(database)]


def find(conn: sqlite3.Connection, query: str, key: str, what: str) -> sqlite3.Row:
    """Fetch one row, or answer 404 when there isn't one."""
    row = conn.execute(query, (key,)).fetchone()
    if row is None:
        raise HTTPException(404, f"No {what} {key}")
    return row


def find_record(
    conn: sqlite3.Connection, query: str, key: str, what: str
) -> dict[str, Any]:
    """Fetch one record from data/, or answer 404."""
    return json.loads(find(conn, query, key, what)["record"])


def optional(text: str | None) -> Any:
    """Read a workflow column that is empty until it applies."""
    return json.loads(text) if text else None


def claim_from(row: sqlite3.Row) -> dict[str, Any]:
    """Combine a claim's record with where it stands."""
    return {
        **json.loads(row["record"]),
        "customer_name": row["customer_name"],
        "status": row["status"],
        "decision": optional(row["decision"]),
        "sign_off": optional(row["sign_off"]),
        "payment": optional(row["payment"]),
    }


def load_claim(conn: sqlite3.Connection, claim_id: str) -> dict[str, Any]:
    """Fetch a claim in full, or answer 404."""
    return claim_from(find(conn, CLAIM_QUERY, claim_id, "claim"))


def now() -> str:
    """Return the time now in UTC, ISO 8601."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def money(amount: float) -> str:
    """Format an amount in US dollars, such as $1,250.00."""
    return f"${amount:,.2f}"


def payout_limit(conn: sqlite3.Connection) -> float:
    """Return the payout above which a handler must sign off, from company.json."""
    company = json.loads(conn.execute("SELECT record FROM company").fetchone()[0])
    return company["payout_approval_limit"]


def refuse(claim: dict[str, Any], allowed: str, action: str) -> None:
    """Answer 409 unless the claim is in the status the action needs."""
    if claim["status"] != allowed:
        raise HTTPException(
            409,
            f"{claim['claim_id']} is {STATUS_TEXT[claim['status']]}, "
            f"and only a claim {STATUS_TEXT[allowed]} can be {action}",
        )


def payment_refusal(claim: dict[str, Any], amount: float, limit: float) -> str | None:
    """Say why a payment can't be made, or return None when it can."""
    decision = claim["decision"]
    if decision is None:
        return f"{claim['claim_id']} has no decision yet, so there is nothing to pay"
    if decision["decision"] != "approve":
        return (
            f"{claim['claim_id']} was {DECIDED_TEXT[decision['decision']]}, "
            "so there is nothing to pay"
        )
    if claim["payment"]:
        return (
            f"{claim['claim_id']} has already been paid "
            f"{money(claim['payment']['amount'])}"
        )
    if amount != decision["payout"]:
        return (
            f"The amount {money(amount)} is not the approved payout of "
            f"{money(decision['payout'])}"
        )
    if decision["payout"] > limit and claim["sign_off"] is None:
        return (
            f"A payout over {money(limit)} needs a handler's sign-off "
            "before it can be paid"
        )
    return None


def insert_step(
    conn: sqlite3.Connection, claim_id: str, thread_id: str, kind: str, detail: str
) -> dict[str, Any]:
    """Record a step on a claim and return it."""
    created_at = now()
    cursor = conn.execute(
        "INSERT INTO steps (claim_id, thread_id, kind, detail, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (claim_id, thread_id, kind, detail, created_at),
    )
    return {
        "step_id": cursor.lastrowid,
        "thread_id": thread_id,
        "kind": kind,
        "detail": detail,
        "created_at": created_at,
    }


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Check that the backend is running."""
    return {"status": "ok"}


@app.get("/api/claims", operation_id="list_claims")
def list_claims(conn: Database) -> list[dict[str, Any]]:
    """List the claims queue in order, with where each claim stands."""
    summaries = []
    for row in conn.execute(CLAIMS_QUERY):
        claim = claim_from(row)
        decision = claim["decision"] or {}
        summaries.append(
            {
                "claim_id": claim["claim_id"],
                "customer_name": claim["customer_name"],
                "claim_type": claim["claim_type"],
                "submitted_on": claim["submitted_on"],
                "amount_claimed": claim["amount_claimed"],
                "status": claim["status"],
                "decision": decision.get("decision"),
                "payout": decision.get("payout"),
            }
        )
    return summaries


@app.get("/api/claims/{claim_id}", operation_id="get_claim")
def get_claim(claim_id: str, conn: Database) -> dict[str, Any]:
    """Get a claim in full, with its status, decision, sign-off and payment."""
    return load_claim(conn, claim_id)


@app.get("/api/policies/{policy_id}", operation_id="get_policy")
def get_policy(policy_id: str, conn: Database) -> dict[str, Any]:
    """Get a policy with its plan's limits and its add-ons."""
    policy = find_record(
        conn, "SELECT record FROM policies WHERE policy_id = ?", policy_id, "policy"
    )
    plan = conn.execute(
        "SELECT record FROM plans WHERE plan = ?", (policy["plan"],)
    ).fetchone()
    add_ons = [
        json.loads(row["record"])
        for row in conn.execute("SELECT add_on, record FROM add_ons ORDER BY add_on")
        if row["add_on"] in policy["add_ons"]
    ]
    return {
        **policy,
        "plan_limits": json.loads(plan["record"]),
        "add_on_details": add_ons,
    }


@app.get("/api/customers/{customer_id}/history", operation_id="get_claim_history")
def get_claim_history(customer_id: str, conn: Database) -> dict[str, Any]:
    """Get a customer's name, when they joined and their earlier claims."""
    customer = find_record(
        conn,
        "SELECT record FROM customers WHERE customer_id = ?",
        customer_id,
        "customer",
    )
    return {
        "customer_id": customer["customer_id"],
        "name": customer["name"],
        "customer_since": customer["customer_since"],
        "previous_claims": customer["previous_claims"],
    }


@app.get("/api/handlers", operation_id="list_handlers")
def list_handlers(conn: Database) -> list[dict[str, Any]]:
    """List the claims handlers who can sign off a payout."""
    handlers = []
    for row in conn.execute("SELECT record FROM handlers ORDER BY handler_id"):
        handler = json.loads(row["record"])
        handlers.append(
            {
                "handler_id": handler["handler_id"],
                "name": handler["name"],
                "role": handler["role"],
                "can_approve_over_limit": handler["can_approve_over_limit"],
            }
        )
    return handlers


@app.post("/api/claims/{claim_id}/start", operation_id="start_claim")
def start_claim(claim_id: str, start: Start, conn: Database) -> dict[str, Any]:
    """Move a waiting claim to in progress, or restart a claim in progress."""
    with db.transaction(conn):
        claim = load_claim(conn, claim_id)
        if claim["status"] not in {"waiting", "in_progress"}:
            raise HTTPException(
                409,
                f"{claim_id} is {STATUS_TEXT[claim['status']]}, "
                "so it can't be started again",
            )
        conn.execute(
            "UPDATE claims SET status = 'in_progress' WHERE claim_id = ?", (claim_id,)
        )
        insert_step(conn, claim_id, start.thread_id, "start", "Started the claim")
    return load_claim(conn, claim_id)


@app.post("/api/claims/{claim_id}/steps", operation_id="add_step")
def add_step(claim_id: str, step: Step, conn: Database) -> dict[str, Any]:
    """Record a step the agent took on a claim."""
    with conn:
        load_claim(conn, claim_id)
        return insert_step(conn, claim_id, step.thread_id, step.kind, step.detail)


@app.get("/api/claims/{claim_id}/steps", operation_id="list_steps")
def list_steps(claim_id: str, conn: Database) -> list[dict[str, Any]]:
    """List the steps taken on a claim, oldest first."""
    load_claim(conn, claim_id)
    rows = conn.execute(
        "SELECT step_id, thread_id, kind, detail, created_at FROM steps "
        "WHERE claim_id = ? ORDER BY step_id",
        (claim_id,),
    )
    return [dict(row) for row in rows]


@app.post("/api/claims/{claim_id}/decision", operation_id="decide_claim")
def decide_claim(claim_id: str, decision: Decision, conn: Database) -> dict[str, Any]:
    """Record the decision on a claim in progress."""
    with db.transaction(conn):
        refuse(load_claim(conn, claim_id), "in_progress", "decided")
        over_limit = decision.payout > payout_limit(conn)
        status = "waiting_for_sign_off" if over_limit else "decided"
        record = {**decision.model_dump(), "decided_at": now()}
        conn.execute(
            "UPDATE claims SET status = ?, decision = ? WHERE claim_id = ?",
            (status, json.dumps(record), claim_id),
        )
    return load_claim(conn, claim_id)


@app.post("/api/claims/{claim_id}/payment", operation_id="pay_claim")
def pay_claim(claim_id: str, payment: Payment, conn: Database) -> dict[str, Any]:
    """Pay an approved claim its payout, once signed off if it's over the limit."""
    with db.transaction(conn):
        claim = load_claim(conn, claim_id)
        refusal = payment_refusal(claim, payment.amount, payout_limit(conn))
        if refusal:
            raise HTTPException(409, refusal)
        record = {"amount": payment.amount, "paid_at": now()}
        conn.execute(
            "UPDATE claims SET payment = ? WHERE claim_id = ?",
            (json.dumps(record), claim_id),
        )
    return load_claim(conn, claim_id)


@app.post("/api/claims/{claim_id}/sign-off", operation_id="sign_off_claim")
def sign_off_claim(claim_id: str, sign_off: SignOff, conn: Database) -> dict[str, Any]:
    """Sign off an approval over the limit as a handler, so it can be paid."""
    with db.transaction(conn):
        claim = load_claim(conn, claim_id)
        handler = find_record(
            conn,
            "SELECT record FROM handlers WHERE handler_id = ?",
            sign_off.handler_id,
            "handler",
        )
        refuse(claim, "waiting_for_sign_off", "signed off")
        if not handler["can_approve_over_limit"]:
            raise HTTPException(
                403, f"{handler['name']} can't sign off a payout over the limit"
            )
        record = {
            "handler_id": handler["handler_id"],
            "handler_name": handler["name"],
            "signed_off_at": now(),
        }
        conn.execute(
            "UPDATE claims SET status = 'decided', sign_off = ? WHERE claim_id = ?",
            (json.dumps(record), claim_id),
        )
    return load_claim(conn, claim_id)
