from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.main import app
from backend.seed import load, seed

client = TestClient(app)


def test_seed_counts():
    assert seed() == {
        "claims": 25,
        "policies": 50,
        "customers": 49,
        "plans": 3,
        "handlers": 3,
    }


def test_seed_starts_every_claim_waiting():
    with closing(db.connect()) as conn:
        statuses = {row[0] for row in conn.execute("SELECT status FROM claims")}
    assert statuses == {"waiting"}


def test_startup_seeds_a_missing_database(tmp_path, monkeypatch):
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "new.db"))
    with TestClient(app) as started:
        assert len(started.get("/api/claims").json()) == 25


def test_list_claims():
    claims = client.get("/api/claims").json()
    assert [c["claim_id"] for c in claims] == [f"CLM-{n}" for n in range(1001, 1026)]
    assert claims[0] == {
        "claim_id": "CLM-1001",
        "customer_name": "Maya Patel",
        "claim_type": "trip_delay",
        "submitted_on": "2026-06-24",
        "amount_claimed": 420.0,
        "status": "waiting",
        "decision": None,
        "payout": None,
    }


def test_get_claim():
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["customer_name"] == "Maya Patel"
    assert claim["status"] == "waiting"
    assert claim["story"].startswith("My flight home from Rome")
    assert len(claim["items"]) == 3
    assert len(claim["documents"]) == 4
    assert claim["decision"] is None
    assert claim["sign_off"] is None
    assert claim["payment"] is None


def test_get_policy():
    policy = client.get("/api/policies/POL-2001").json()
    assert policy["plan"] == "premium"
    assert policy["plan_limits"]["name"] == "UnderCover Premium"
    assert policy["plan_limits"]["per_item_limit"] == 300.0
    assert policy["plan_limits"]["deductible"] == 50.0
    assert policy["add_on_details"] == []


def test_get_policy_with_add_ons():
    with_add_on = next(p for p in load("policies.json") if p["add_ons"])
    policy = client.get(f"/api/policies/{with_add_on['policy_id']}").json()
    assert [a["add_on"] for a in policy["add_on_details"]] == sorted(
        with_add_on["add_ons"]
    )


def test_get_claim_history():
    history = client.get("/api/customers/CUS-3001/history").json()
    assert history["name"] == "Maya Patel"
    assert history["customer_since"] == "2023-04-11"
    assert [c["claim_id"] for c in history["previous_claims"]] == ["CLM-0412"]
    assert set(history) == {"customer_id", "name", "customer_since", "previous_claims"}


def test_list_handlers():
    handlers = client.get("/api/handlers").json()
    assert [h["name"] for h in handlers] == [
        "Dana Whitfield",
        "Marcus Oyelaran",
        "Priya Raman",
    ]
    assert "email" not in handlers[0]


@pytest.mark.parametrize(
    ("path", "detail"),
    [
        ("/api/claims/CLM-9999", "No claim CLM-9999"),
        ("/api/policies/POL-9999", "No policy POL-9999"),
        ("/api/customers/CUS-9999/history", "No customer CUS-9999"),
    ],
)
def test_unknown_ids_return_404(path, detail):
    response = client.get(path)
    assert response.status_code == 404
    assert response.json() == {"detail": detail}


def test_get_instructions():
    instructions = client.get("/api/instructions").json()["instructions"]
    assert instructions.startswith("# The UnderCover Agent")
    assert "The policy wording follows." in instructions
    assert "Version 2026.1" in instructions
    assert instructions.index("decide_claim") < instructions.index("Version 2026.1")
