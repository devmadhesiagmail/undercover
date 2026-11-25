from fastapi.testclient import TestClient

from agent import __main__ as cli
from agent import main
from backend.main import app

client = TestClient(app)


def decide(claim_id, payout):
    client.post(f"/api/claims/{claim_id}/start", json={"thread_id": "t"})
    client.post(
        f"/api/claims/{claim_id}/decision",
        json={
            "decision": "approve",
            "payout": payout,
            "reason": "Covered.",
            "policy_section": "Section 3, Trip Delay",
        },
    )


def record_runs(monkeypatch):
    worked = []
    monkeypatch.setattr(
        main, "run", lambda claim_id, thread_id: worked.append(claim_id)
    )
    return worked


def test_with_no_ids_it_works_the_waiting_claims_in_queue_order(monkeypatch):
    decide("CLM-1001", 420)
    worked = record_runs(monkeypatch)
    cli.work([])
    assert worked == [f"CLM-{n}" for n in range(1002, 1026)]


def test_with_ids_it_works_those_claims(monkeypatch):
    worked = record_runs(monkeypatch)
    cli.work(["CLM-1003", "CLM-1001"])
    assert worked == ["CLM-1003", "CLM-1001"]


def test_it_prints_one_line_per_claim(monkeypatch, capsys):
    monkeypatch.setattr(main, "run", lambda claim_id, thread_id: decide(claim_id, 1150))
    cli.work(["CLM-1002", "CLM-1003"])
    assert capsys.readouterr().out.splitlines() == [
        "CLM-1002  approve  $1,150.00  waiting for sign off",
        "CLM-1003  approve  $1,150.00  waiting for sign off",
    ]


def test_a_claim_with_no_decision(monkeypatch, capsys):
    record_runs(monkeypatch)
    cli.work(["CLM-1001"])
    assert capsys.readouterr().out == "CLM-1001  no decision  waiting\n"


def test_a_claim_already_decided_is_left_as_it_was(capsys):
    decide("CLM-1001", 420)
    before = client.get("/api/claims/CLM-1001").json()
    cli.work(["CLM-1001"])
    assert capsys.readouterr().out == (
        "CLM-1001  not started: CLM-1001 is decided, so it can't be started again\n"
    )
    assert client.get("/api/claims/CLM-1001").json() == before


def test_no_claims_waiting(monkeypatch, capsys):
    monkeypatch.setattr(cli, "waiting_claims", list)
    cli.work([])
    assert capsys.readouterr().out == "No claims are waiting.\n"
