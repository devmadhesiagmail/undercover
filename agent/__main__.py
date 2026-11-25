"""Work claims from the command line.

uv run -m agent works every waiting claim in queue order.
uv run -m agent CLM-1001 works the claims named.
"""

import sys
import uuid

from agent import main


def waiting_claims() -> list[str]:
    """Return the ids of the waiting claims, in queue order."""
    with main.backend() as client:
        claims = client.get("/api/claims").raise_for_status().json()
    return [claim["claim_id"] for claim in claims if claim["status"] == "waiting"]


def outcome(claim_id: str) -> str:
    """Describe where a claim stands, in one line."""
    with main.backend() as client:
        claim = client.get(f"/api/claims/{claim_id}").raise_for_status().json()
    status = claim["status"].replace("_", " ")
    decision = claim["decision"]
    if decision is None:
        return f"{claim_id}  no decision  {status}"
    return f"{claim_id}  {decision['decision']}  ${decision['payout']:,.2f}  {status}"


def work(claim_ids: list[str]) -> None:
    """Work each claim and print one line for it."""
    claim_ids = claim_ids or waiting_claims()
    if not claim_ids:
        print("No claims are waiting.")
    for claim_id in claim_ids:
        try:
            main.run(claim_id, str(uuid.uuid4()))
        except main.Refused as refusal:
            print(f"{claim_id}  not started: {refusal}")
            continue
        print(outcome(claim_id))


if __name__ == "__main__":
    work(sys.argv[1:])
