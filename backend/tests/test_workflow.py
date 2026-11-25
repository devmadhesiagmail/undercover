import json
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.main import app

client = TestClient(app)

REASON = "The carrier confirmed the delay and its cause. The costs are covered."


def start(claim_id, thread_id="thread-1"):
    return client.post(f"/api/claims/{claim_id}/start", json={"thread_id": thread_id})


def decide(claim_id, decision, payout):
    return client.post(
        f"/api/claims/{claim_id}/decision",
        json={
            "decision": decision,
            "payout": payout,
            "reason": REASON,
            "policy_section": "Section 3, Trip Delay",
        },
    )


def pay(claim_id, amount):
    return client.post(f"/api/claims/{claim_id}/payment", json={"amount": amount})


def sign_off(claim_id, handler_id):
    return client.post(
        f"/api/claims/{claim_id}/sign-off", json={"handler_id": handler_id}
    )


def get(claim_id):
    return client.get(f"/api/claims/{claim_id}").json()


def approved(claim_id, payout):
    start(claim_id)
    assert decide(claim_id, "approve", payout).status_code == 200


def test_start_moves_a_waiting_claim_to_in_progress():
    response = start("CLM-1001")
    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"
    steps = client.get("/api/claims/CLM-1001/steps").json()
    assert [(s["kind"], s["thread_id"]) for s in steps] == [("start", "thread-1")]


def test_start_restarts_a_claim_in_progress():
    start("CLM-1001", "thread-1")
    response = start("CLM-1001", "thread-2")
    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"


def test_start_is_refused_on_a_decided_claim():
    approved("CLM-1001", 420)
    response = start("CLM-1001")
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "CLM-1001 is decided, so it can't be started again"
    )


def test_approval_within_the_limit_is_decided():
    start("CLM-1001")
    claim = decide("CLM-1001", "approve", 420).json()
    assert claim["status"] == "decided"
    assert claim["decision"]["decision"] == "approve"
    assert claim["decision"]["payout"] == 420
    assert claim["decision"]["policy_section"] == "Section 3, Trip Delay"
    assert claim["decision"]["decided_at"]


def test_approval_over_the_limit_waits_for_sign_off():
    start("CLM-1002")
    assert decide("CLM-1002", "approve", 1150).json()["status"] == (
        "waiting_for_sign_off"
    )


@pytest.mark.parametrize("decision", ["decline", "refer"])
def test_decline_and_referral_are_decided_with_no_payout(decision):
    start("CLM-1003")
    claim = decide("CLM-1003", decision, 0).json()
    assert claim["status"] == "decided"
    assert claim["decision"]["payout"] == 0


def test_a_second_decision_is_refused():
    approved("CLM-1001", 420)
    response = decide("CLM-1001", "decline", 0)
    assert response.status_code == 409
    assert "only a claim in progress can be decided" in response.json()["detail"]


def test_a_claim_not_started_cannot_be_decided():
    assert decide("CLM-1001", "approve", 420).status_code == 409


@pytest.mark.parametrize(
    ("decision", "payout"), [("approve", 0), ("decline", 100), ("refer", 50)]
)
def test_payout_must_fit_the_decision(decision, payout):
    start("CLM-1001")
    assert decide("CLM-1001", decision, payout).status_code == 422
    assert get("CLM-1001")["decision"] is None


def test_pay_an_approval_within_the_limit():
    approved("CLM-1001", 420)
    response = pay("CLM-1001", 420)
    assert response.status_code == 200
    assert response.json()["payment"]["amount"] == 420
    assert response.json()["payment"]["paid_at"]


@pytest.mark.parametrize("decision", ["decline", "refer"])
def test_pay_is_refused_without_an_approval(decision):
    start("CLM-1003")
    decide("CLM-1003", decision, 0)
    response = pay("CLM-1003", 100)
    assert response.status_code == 409
    assert "so there is nothing to pay" in response.json()["detail"]


def test_pay_is_refused_before_a_decision():
    start("CLM-1001")
    assert pay("CLM-1001", 420).json()["detail"] == (
        "CLM-1001 has no decision yet, so there is nothing to pay"
    )


def test_pay_is_refused_for_another_amount():
    approved("CLM-1001", 420)
    response = pay("CLM-1001", 500)
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "The amount $500.00 is not the approved payout of $420.00"
    )
    assert get("CLM-1001")["payment"] is None


def test_pay_is_refused_a_second_time():
    approved("CLM-1001", 420)
    pay("CLM-1001", 420)
    response = pay("CLM-1001", 420)
    assert response.status_code == 409
    assert response.json()["detail"] == "CLM-1001 has already been paid $420.00"


def test_pay_over_the_limit_waits_for_sign_off():
    approved("CLM-1002", 1150)
    response = pay("CLM-1002", 1150)
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "A payout over $1,000.00 needs a handler's sign-off before it can be paid"
    )
    assert get("CLM-1002")["payment"] is None
    sign_off("CLM-1002", "HND-01")
    assert pay("CLM-1002", 1150).status_code == 200


def test_sign_off_records_the_handler_and_decides_the_claim():
    approved("CLM-1002", 1150)
    claim = sign_off("CLM-1002", "HND-01").json()
    assert claim["status"] == "decided"
    assert claim["sign_off"]["handler_id"] == "HND-01"
    assert claim["sign_off"]["handler_name"] == "Dana Whitfield"
    assert claim["sign_off"]["signed_off_at"]


def test_sign_off_only_on_a_claim_waiting_for_sign_off():
    approved("CLM-1001", 420)
    response = sign_off("CLM-1001", "HND-01")
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "CLM-1001 is decided, and only a claim waiting for sign-off can be signed off"
    )


def test_sign_off_by_an_unknown_handler():
    approved("CLM-1002", 1150)
    response = sign_off("CLM-1002", "HND-99")
    assert response.status_code == 404
    assert get("CLM-1002")["status"] == "waiting_for_sign_off"


def test_sign_off_by_a_handler_who_cannot_approve_over_the_limit():
    with closing(db.connect()) as conn, conn:
        conn.execute(
            "UPDATE handlers SET record = json_set(record, "
            "'$.can_approve_over_limit', json('false')) WHERE handler_id = 'HND-03'"
        )
    approved("CLM-1002", 1150)
    response = sign_off("CLM-1002", "HND-03")
    assert response.status_code == 403
    assert get("CLM-1002")["sign_off"] is None


def test_the_limit_comes_from_the_company_settings():
    with closing(db.connect()) as conn, conn:
        company = json.loads(conn.execute("SELECT record FROM company").fetchone()[0])
        company["payout_approval_limit"] = 2000
        conn.execute("UPDATE company SET record = ?", (json.dumps(company),))
    approved("CLM-1002", 1150)
    assert get("CLM-1002")["status"] == "decided"
    assert pay("CLM-1002", 1150).status_code == 200


def test_steps_come_back_in_order():
    start("CLM-1001", "thread-1")
    for kind, detail in [
        ("call", 'get_claim {"claim_id": "CLM-1001"}'),
        ("result", "get_claim: {}"),
        ("message", "Approved."),
    ]:
        response = client.post(
            "/api/claims/CLM-1001/steps",
            json={"thread_id": "thread-1", "kind": kind, "detail": detail},
        )
        assert response.status_code == 200
    steps = client.get("/api/claims/CLM-1001/steps").json()
    assert [s["kind"] for s in steps] == ["start", "call", "result", "message"]
    assert steps[1]["detail"] == 'get_claim {"claim_id": "CLM-1001"}'
    assert all(s["thread_id"] == "thread-1" and s["created_at"] for s in steps)
    assert [s["step_id"] for s in steps] == sorted(s["step_id"] for s in steps)


def test_steps_on_an_unknown_claim():
    assert client.get("/api/claims/CLM-9999/steps").status_code == 404
    response = client.post(
        "/api/claims/CLM-9999/steps",
        json={"thread_id": "thread-1", "kind": "message", "detail": "Hello"},
    )
    assert response.status_code == 404


def test_a_step_needs_a_known_kind():
    response = client.post(
        "/api/claims/CLM-1001/steps",
        json={"thread_id": "thread-1", "kind": "thought", "detail": "Hmm"},
    )
    assert response.status_code == 422
