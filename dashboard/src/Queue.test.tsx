import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ClaimSummary } from "./api";
import { Queue } from "./Queue";
import { stubApi } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const claims: ClaimSummary[] = [
  {
    claim_id: "CLM-1001",
    customer_name: "Maya Patel",
    claim_type: "trip_delay",
    submitted_on: "2026-06-24",
    amount_claimed: 420,
    status: "decided",
    decision: "approve",
    payout: 420,
  },
  {
    claim_id: "CLM-1002",
    customer_name: "Tomas Novak",
    claim_type: "baggage",
    submitted_on: "2026-07-20",
    amount_claimed: 1150,
    status: "waiting_for_sign_off",
    decision: "approve",
    payout: 1150,
  },
  {
    claim_id: "CLM-1003",
    customer_name: "Ana Souza",
    claim_type: "emergency_medical",
    submitted_on: "2026-07-02",
    amount_claimed: 3800,
    status: "waiting",
    decision: null,
    payout: null,
  },
];

it("shows each claim in queue order, linked to its page", async () => {
  stubApi({ "/api/claims": claims });
  render(<Queue />);
  const links = await screen.findAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "CLM-1001",
    "CLM-1002",
    "CLM-1003",
  ]);
  expect(links[0].getAttribute("href")).toBe("#/claims/CLM-1001");
});

it("shows each column formatted for people", async () => {
  stubApi({ "/api/claims": claims });
  render(<Queue />);
  const rows = await screen.findAllByRole("row");
  expect(rows).toHaveLength(4);
  const first = within(rows[1]);
  expect(first.getByText("Maya Patel")).toBeDefined();
  expect(first.getByText("Trip delay")).toBeDefined();
  expect(first.getByText("Jun 24, 2026")).toBeDefined();
  expect(first.getByText("$420.00")).toBeDefined();
  expect(first.getByText("Decided")).toBeDefined();
  expect(first.getByText("Approved $420.00")).toBeDefined();
  const third = within(rows[3]);
  expect(third.getByText("Emergency medical")).toBeDefined();
  expect(third.getByText("Waiting")).toBeDefined();
  expect(third.getByText("None yet")).toBeDefined();
});

it("counts the claims in each state", async () => {
  stubApi({ "/api/claims": claims });
  render(<Queue />);
  const counts = await screen.findByRole("region", {
    name: "Claims in each state",
  });
  expect(counts.textContent).toBe(
    "1Waiting0In progress1Waiting for sign-off1Decided",
  );
});

it("says when the queue can't be loaded", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  render(<Queue />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Can't load this page. Error: Offline",
  );
});
