"""The UnderCover backend."""

import json
import sqlite3
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, closing
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException

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
