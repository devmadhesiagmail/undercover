"""The UnderCover Agent."""

import json
import os
from collections.abc import Iterator
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph.state import CompiledStateGraph
from pydantic import SecretStr

load_dotenv(override=True)

BACKEND_URL = "http://localhost:8000"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-6-luna"


class Refused(Exception):
    """The backend refused to start the claim."""


def backend() -> httpx.Client:
    """Return a client for the UnderCover backend."""
    return httpx.Client(base_url=BACKEND_URL, timeout=30)


def call(method: str, path: str, body: dict[str, Any] | None = None) -> str:
    """Call the backend and return its JSON, or why it refused."""
    with backend() as client:
        response = client.request(method, path, json=body)
    if response.is_client_error:
        return f"Refused: {response.json()['detail']}"
    response.raise_for_status()
    return response.text


@tool
def get_claim(claim_id: str) -> str:
    """Get a claim in full: the story, the items claimed and the documents."""
    return call("GET", f"/api/claims/{claim_id}")


@tool
def get_policy(policy_id: str) -> str:
    """Get a policy: the plan and its limits, the add-ons, the trip and travelers."""
    return call("GET", f"/api/policies/{policy_id}")


@tool
def get_claim_history(customer_id: str) -> str:
    """Get a customer's name, when they became a customer and their earlier claims."""
    return call("GET", f"/api/customers/{customer_id}/history")


@tool
def decide_claim(
    claim_id: str,
    decision: Literal["approve", "decline", "refer"],
    payout: float,
    reason: str,
    policy_section: str,
) -> str:
    """Record the decision on a claim, with the payout, the reason and the section.

    An approval has a payout above zero, and a decline or a referral has a payout
    of zero. The reason is two or three plain sentences. The section is given by
    number and name, such as "Section 3, Trip Delay".
    """
    return call(
        "POST",
        f"/api/claims/{claim_id}/decision",
        {
            "decision": decision,
            "payout": payout,
            "reason": reason,
            "policy_section": policy_section,
        },
    )


@tool
def pay_claim(claim_id: str, amount: float) -> str:
    """Pay an approved claim its payout. Over $1,000 waits for a handler's sign-off."""
    return call("POST", f"/api/claims/{claim_id}/payment", {"amount": amount})


TOOLS = [get_claim, get_policy, get_claim_history, decide_claim, pay_claim]


def model() -> ChatOpenAI:
    """Return the model named in MODEL_NAME, or GPT-6 Luna by default."""
    name = os.getenv("MODEL_NAME")
    return ChatOpenAI(
        model=name or DEFAULT_MODEL,
        base_url=OPENROUTER_BASE_URL,
        api_key=SecretStr(os.environ["OPENROUTER_API_KEY"]),
        reasoning_effort=None if name else "low",
    )


def steps(message: BaseMessage) -> list[tuple[str, str]]:
    """Turn a message from the agent into the steps the dashboard shows."""
    text = str(message.text)
    if isinstance(message, ToolMessage):
        return [("result", f"{message.name}: {text}")]
    found = [("message", text)] if text else []
    if isinstance(message, AIMessage):
        found += [
            ("call", f"{call['name']} {json.dumps(call['args'])}")
            for call in message.tool_calls
        ]
    return found


def messages(
    agent: CompiledStateGraph[Any, Any, Any, Any], claim_id: str, thread_id: str
) -> Iterator[BaseMessage]:
    """Stream the agent on a claim and yield each message as it arrives."""
    for update in agent.stream(
        {"messages": [{"role": "user", "content": f"Work claim {claim_id}."}]},
        config={"configurable": {"thread_id": thread_id}},
        stream_mode="updates",
    ):
        for node in update.values():
            yield from node["messages"]


def run(claim_id: str, thread_id: str, llm: BaseChatModel | None = None) -> str:
    """Work one claim, posting each step to the backend, and return the last reply."""
    with backend() as client:
        response = client.get("/api/instructions").raise_for_status()
        instructions = response.json()["instructions"]
        started = client.post(
            f"/api/claims/{claim_id}/start", json={"thread_id": thread_id}
        )
        if started.is_client_error:
            raise Refused(started.json()["detail"])
        started.raise_for_status()
        agent = create_agent(llm or model(), tools=TOOLS, system_prompt=instructions)
        reply = ""
        for message in messages(agent, claim_id, thread_id):
            for kind, detail in steps(message):
                client.post(
                    f"/api/claims/{claim_id}/steps",
                    json={"thread_id": thread_id, "kind": kind, "detail": detail},
                ).raise_for_status()
            if isinstance(message, AIMessage) and message.text:
                reply = str(message.text)
    return reply
