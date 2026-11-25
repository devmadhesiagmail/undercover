"""Reset the database from UnderCover's records in data/."""

import json
from contextlib import closing
from pathlib import Path
from typing import Any

from backend import db

DATA = Path(__file__).parent.parent / "data"


def load(name: str) -> Any:
    """Read one of UnderCover's JSON files from data/."""
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def rows(records: list[dict[str, Any]], key: str) -> list[tuple[str, str]]:
    """Pair each record's id with the record as JSON."""
    return [(record[key], json.dumps(record)) for record in records]


def seed() -> dict[str, int]:
    """Reset the database from data/ and return how many of each record it holds."""
    company = load("company.json")
    plans = load("plans.json")
    handlers = load("handlers.json")
    customers = load("customers.json")
    policies = load("policies.json")
    claims = load("claims.json")
    with closing(db.connect()) as conn, conn:
        conn.executescript(db.RESET)
        conn.execute("INSERT INTO company VALUES (1, ?)", (json.dumps(company),))
        conn.executemany(
            "INSERT INTO plans VALUES (?, ?)", rows(plans["plans"], "plan")
        )
        conn.executemany(
            "INSERT INTO add_ons VALUES (?, ?)", rows(plans["add_ons"], "add_on")
        )
        conn.executemany(
            "INSERT INTO handlers VALUES (?, ?)", rows(handlers, "handler_id")
        )
        conn.executemany(
            "INSERT INTO customers VALUES (?, ?)", rows(customers, "customer_id")
        )
        conn.executemany(
            "INSERT INTO policies VALUES (?, ?)", rows(policies, "policy_id")
        )
        conn.executemany(
            "INSERT INTO claims (claim_id, record, status) VALUES (?, ?, 'waiting')",
            rows(claims, "claim_id"),
        )
    return {
        "claims": len(claims),
        "policies": len(policies),
        "customers": len(customers),
        "plans": len(plans["plans"]),
        "handlers": len(handlers),
    }


if __name__ == "__main__":
    counts = seed()
    print(f"Seeded {db.path()}: " + ", ".join(f"{n} {k}" for k, n in counts.items()))
