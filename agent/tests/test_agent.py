import inspect
import json
import re

from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage

from agent import main
from backend.main import app

client = TestClient(app)


class StubModel(GenericFakeChatModel):
    """A chat model that gives scripted replies and keeps what it was sent."""

    received: list[list[BaseMessage]] = []

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.received.append(messages)
        return super()._generate(messages, stop, run_manager, **kwargs)


def tool_call(name, **args):
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": name}])


def decision(claim_id, choice, payout):
    return tool_call(
        "decide_claim",
        claim_id=claim_id,
        decision=choice,
        payout=payout,
        reason="The claim is covered. The documents support it.",
        policy_section="Section 3, Trip Delay",
    )


def script(claim_id, policy_id, customer_id, *rest):
    replies = [
        tool_call("get_claim", claim_id=claim_id),
        tool_call("get_policy", policy_id=policy_id),
        tool_call("get_claim_history", customer_id=customer_id),
        *rest,
    ]
    return StubModel(messages=iter(replies))


def steps(claim_id):
    return client.get(f"/api/claims/{claim_id}/steps").json()


def test_the_agent_has_exactly_five_tools():
    assert [t.name for t in main.TOOLS] == [
        "get_claim",
        "get_policy",
        "get_claim_history",
        "decide_claim",
        "pay_claim",
    ]


def test_no_tool_reads_a_file():
    source = inspect.getsource(main)
    assert not re.search(r"\bopen\(|read_text|read_bytes|pathlib|data/", source)


def test_each_tool_calls_its_operation():
    claim = json.loads(main.get_claim.invoke({"claim_id": "CLM-1001"}))
    assert claim["customer_name"] == "Maya Patel"
    policy = json.loads(main.get_policy.invoke({"policy_id": "POL-2001"}))
    assert policy["plan_limits"]["per_item_limit"] == 300
    history = json.loads(main.get_claim_history.invoke({"customer_id": "CUS-3001"}))
    assert history["previous_claims"][0]["claim_id"] == "CLM-0412"
    client.post("/api/claims/CLM-1001/start", json={"thread_id": "t"})
    decided = json.loads(
        main.decide_claim.invoke(
            decision("CLM-1001", "approve", 420).tool_calls[0]["args"]
        )
    )
    assert decided["status"] == "decided"
    paid = json.loads(main.pay_claim.invoke({"claim_id": "CLM-1001", "amount": 420}))
    assert paid["payment"]["amount"] == 420


def test_a_refusal_comes_back_as_text():
    assert main.get_claim.invoke({"claim_id": "CLM-9999"}) == (
        "Refused: No claim CLM-9999"
    )
    assert main.pay_claim.invoke({"claim_id": "CLM-1001", "amount": 420}) == (
        "Refused: CLM-1001 has no decision yet, so there is nothing to pay"
    )


def test_the_system_prompt_is_the_instructions_from_the_backend():
    llm = StubModel(messages=iter([AIMessage(content="Nothing to do.")]))
    main.run("CLM-1001", "thread-1", llm)
    system = llm.received[0][0]
    assert isinstance(system, SystemMessage)
    assert system.content == client.get("/api/instructions").json()["instructions"]


def test_a_run_that_approves_and_pays():
    llm = script(
        "CLM-1001",
        "POL-2001",
        "CUS-3001",
        decision("CLM-1001", "approve", 420),
        tool_call("pay_claim", claim_id="CLM-1001", amount=420),
        AIMessage(content="Approved CLM-1001 and paid $420.00."),
    )
    assert (
        main.run("CLM-1001", "thread-1", llm) == "Approved CLM-1001 and paid $420.00."
    )
    claim = client.get("/api/claims/CLM-1001").json()
    assert claim["status"] == "decided"
    assert claim["payment"]["amount"] == 420
    recorded = steps("CLM-1001")
    assert [s["kind"] for s in recorded] == ["start"] + ["call", "result"] * 5 + [
        "message"
    ]
    assert [s["detail"].split(" ")[0] for s in recorded if s["kind"] == "call"] == [
        "get_claim",
        "get_policy",
        "get_claim_history",
        "decide_claim",
        "pay_claim",
    ]
    assert recorded[1]["detail"] == 'get_claim {"claim_id": "CLM-1001"}'
    assert recorded[2]["detail"].startswith('get_claim: {"claim_id":"CLM-1001"')
    assert {s["thread_id"] for s in recorded} == {"thread-1"}


def test_a_run_over_the_limit_waits_for_sign_off():
    llm = script(
        "CLM-1002",
        "POL-2002",
        "CUS-3002",
        decision("CLM-1002", "approve", 1150),
        tool_call("pay_claim", claim_id="CLM-1002", amount=1150),
        AIMessage(content="Approved CLM-1002. The payment waits for sign-off."),
    )
    main.run("CLM-1002", "thread-1", llm)
    claim = client.get("/api/claims/CLM-1002").json()
    assert claim["status"] == "waiting_for_sign_off"
    assert claim["payment"] is None
    pay_result = [s for s in steps("CLM-1002") if s["kind"] == "result"][-1]
    assert pay_result["detail"] == (
        "pay_claim: Refused: A payout over $1,000.00 needs a handler's sign-off "
        "before it can be paid"
    )


def test_a_decline_and_a_referral_are_decided_with_no_payment():
    for claim_id, policy_id, customer_id, choice in [
        ("CLM-1003", "POL-2003", "CUS-3003", "decline"),
        ("CLM-1004", "POL-2004", "CUS-3004", "refer"),
    ]:
        llm = script(
            claim_id,
            policy_id,
            customer_id,
            decision(claim_id, choice, 0),
            AIMessage(content=f"I chose to {choice} {claim_id}."),
        )
        main.run(claim_id, "thread-1", llm)
        claim = client.get(f"/api/claims/{claim_id}").json()
        assert claim["status"] == "decided"
        assert claim["decision"]["decision"] == choice
        assert claim["payment"] is None


def test_a_message_alongside_a_tool_call_is_a_step():
    reply = AIMessage(
        content="Reading the claim.",
        tool_calls=[{"name": "get_claim", "args": {"claim_id": "X"}, "id": "1"}],
    )
    assert main.steps(reply) == [
        ("message", "Reading the claim."),
        ("call", 'get_claim {"claim_id": "X"}'),
    ]


def test_model_name(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.delenv("MODEL_NAME", raising=False)
    assert main.model().model_name == "openai/gpt-6-luna"
    assert main.model().reasoning_effort == "low"
    monkeypatch.setenv("MODEL_NAME", "openrouter/free")
    assert main.model().model_name == "openrouter/free"
    assert main.model().reasoning_effort is None
