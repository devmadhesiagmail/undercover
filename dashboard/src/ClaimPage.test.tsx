import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Claim } from "./api";
import { ClaimPage } from "./ClaimPage";
import {
  claim,
  claimRoutes,
  history,
  policy,
  stubApi,
  waitingForSignOff,
} from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(shown: Claim, extra: Record<string, unknown> = {}) {
  stubApi({ ...claimRoutes(shown, []), ...extra });
  render(<ClaimPage claimId={shown.claim_id} />);
}

async function section(name: string) {
  return within(await screen.findByRole("region", { name }));
}

it("shows the claim's header", async () => {
  show(claim);
  expect(
    await screen.findByRole("heading", { name: "CLM-1002" }),
  ).toBeDefined();
  expect(
    screen.getByText("Suitcase lost on a connecting flight"),
  ).toBeDefined();
  const facts = screen
    .getAllByRole("term")
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
  expect(facts.slice(0, 5)).toEqual([
    ["Customer", "Tom Becker"],
    ["Type", "Baggage"],
    ["Submitted", "Jul 20, 2026"],
    ["Incident", "Jun 21, 2026, Frankfurt, Germany"],
    ["Claimed", "$1,150.00"],
  ]);
});

it("says when there is no decision yet", async () => {
  show(claim);
  const decision = await section("The agent's decision");
  expect(decision.getByText("No decision yet")).toBeDefined();
  expect(decision.queryByRole("button")).toBeNull();
});

it("shows the story, the items and the documents", async () => {
  show(claim);
  const details = await section("The claim");
  expect(
    details.getByText("My suitcase never arrived in Prague."),
  ).toBeDefined();
  const rows = details.getAllByRole("row").map((row) => row.textContent);
  expect(rows).toEqual([
    "ItemCategoryAmount",
    "Hard-shell suitcaseLuggage$280.00",
    "Wool suitClothing$870.00",
    "Total claimed$1,150.00",
  ]);
  expect(details.getByText("Northwind lost baggage report")).toBeDefined();
  expect(details.getByText("Carrier report")).toBeDefined();
  expect(
    details.getByText("The bag was declared lost after three weeks."),
  ).toBeDefined();
});

it("shows the policy", async () => {
  show(claim);
  const panel = await section("The policy POL-2002");
  expect(await panel.findByText("UnderCover Premium")).toBeDefined();
  expect(panel.getByText("Electronics Plus")).toBeDefined();
  expect(panel.getByText("May 1, 2026")).toBeDefined();
  expect(
    panel.getByText("Prague, Czech Republic, Jun 20, 2026 to Jun 30, 2026"),
  ).toBeDefined();
  expect(panel.getByText("$2,400.00")).toBeDefined();
  expect(panel.getByText("Tom Becker, Ana Becker")).toBeDefined();
});

it("shows a policy with no add-ons", async () => {
  show(claim, {
    "/api/policies/POL-2002": { ...policy, add_ons: [], add_on_details: [] },
  });
  const panel = await section("The policy POL-2002");
  expect(await panel.findByText("None")).toBeDefined();
});

it("shows the customer and their earlier claims", async () => {
  show(claim);
  const panel = await section("The customer");
  expect(await panel.findByText("Jan 5, 2022")).toBeDefined();
  const earlier = panel
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(earlier).toEqual([
    "CLM-0301 Trip delay, filed Mar 2, 2024: Delayed flight to Denver. Approved, paid $120.00",
    "CLM-0377 Baggage, filed Feb 11, 2025: Scratched suitcase. Declined",
  ]);
});

it("shows a customer with no earlier claims", async () => {
  show(claim, {
    "/api/customers/CUS-3002/history": { ...history, previous_claims: [] },
  });
  const panel = await section("The customer");
  expect(await panel.findByText("No earlier claims")).toBeDefined();
});

it("shows an approval waiting for sign-off, with the sign-off form", async () => {
  show(waitingForSignOff);
  const decision = await section("The agent's decision");
  expect(decision.getByText("Approved $1,150.00")).toBeDefined();
  expect(
    decision.getByText(
      "The carrier lost the bag. Each item is within the limit.",
    ),
  ).toBeDefined();
  expect(
    decision.getByText(/^Section 5, Baggage and Personal Effects\. Decided/),
  ).toBeDefined();
  expect(decision.getByText("Waiting for a handler's sign-off")).toBeDefined();
  expect(decision.getByText("Not paid yet")).toBeDefined();
  expect(
    decision.getByRole("button", { name: "Sign off and pay $1,150.00" }),
  ).toBeDefined();
});

it("shows the sign-off and the payment once made", async () => {
  show({
    ...waitingForSignOff,
    status: "decided",
    sign_off: {
      handler_id: "HND-01",
      handler_name: "Dana Whitfield",
      signed_off_at: "2026-11-25T03:50:00+00:00",
    },
    payment: { amount: 1150, paid_at: "2026-11-25T03:50:01+00:00" },
  });
  const decision = await section("The agent's decision");
  expect(decision.getByText(/^Signed off by Dana Whitfield/)).toBeDefined();
  expect(decision.getByText(/^Paid \$1,150\.00/)).toBeDefined();
  expect(decision.queryByRole("button")).toBeNull();
});

it("shows a decline with nothing to pay", async () => {
  show({
    ...claim,
    status: "decided",
    decision: {
      decision: "decline",
      payout: 0,
      reason: "Not covered.",
      policy_section: "Section 9, General exclusions",
      decided_at: "2026-11-25T03:42:59+00:00",
    },
  });
  const decision = await section("The agent's decision");
  expect(decision.getByText("Declined")).toBeDefined();
  expect(decision.getByText("Nothing to pay")).toBeDefined();
  expect(decision.queryByRole("button")).toBeNull();
});

it("says when the claim can't be loaded", async () => {
  stubApi({});
  render(<ClaimPage claimId="CLM-9999" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No route /api/claims/CLM-9999",
  );
});
