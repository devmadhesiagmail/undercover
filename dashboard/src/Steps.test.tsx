import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Step } from "./api";
import { Steps } from "./Steps";
import { stubApi } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function step(step_id: number, kind: Step["kind"], detail: string): Step {
  return {
    step_id,
    kind,
    detail,
    thread_id: "thread-1",
    created_at: "2026-11-25T03:42:59+00:00",
  };
}

const steps: Step[] = [
  step(1, "start", "Started the claim"),
  step(2, "call", 'get_claim {"claim_id": "CLM-1002"}'),
  step(3, "result", 'get_claim: {"claim_id":"CLM-1002"}'),
  step(
    4,
    "result",
    "pay_claim: Refused: A payout over $1,000.00 needs sign-off",
  ),
  step(5, "result", "get_policy: not json"),
  step(6, "message", "Approved CLM-1002."),
];

function show(shown: Step[]) {
  stubApi({ "/api/claims/CLM-1002/steps": shown });
  render(<Steps claimId="CLM-1002" />);
}

it("shows each kind of step, oldest first", async () => {
  show(steps);
  const items = await screen.findAllByRole("listitem");
  expect(items.map((item) => item.className)).toEqual([
    "step step-start",
    "step step-call",
    "step step-result",
    "step step-result",
    "step step-result",
    "step step-message",
  ]);
  expect(screen.getByText("Started the claim")).toBeDefined();
  expect(items[1].textContent).toContain(
    'Called get_claim {"claim_id": "CLM-1002"}',
  );
  expect(screen.getByText("Approved CLM-1002.")).toBeDefined();
  expect(items[0].querySelector("time")?.textContent).toMatch(/:59 [AP]M/);
});

it("folds tool results, pretty-printing JSON", async () => {
  show(steps);
  const items = await screen.findAllByRole("listitem");
  const result = items[2].querySelector("details");
  expect(result?.open).toBe(false);
  expect(result?.querySelector("summary")?.textContent).toBe(
    "Result from get_claim",
  );
  expect(result?.querySelector("pre")?.textContent).toBe(
    '{\n  "claim_id": "CLM-1002"\n}',
  );
  expect(items[4].querySelector("pre")?.textContent).toBe("not json");
});

it("marks refusals", async () => {
  show(steps);
  const items = await screen.findAllByRole("listitem");
  const refused = items[3].querySelector("details");
  expect(refused?.className).toBe("step-result refused");
  expect(refused?.querySelector("summary")?.textContent).toBe(
    "Refused pay_claim: A payout over $1,000.00 needs sign-off",
  );
});

it("says when the agent hasn't started", async () => {
  show([]);
  expect(
    await screen.findByText("The agent hasn't started this claim."),
  ).toBeDefined();
});

it("says when the steps can't be loaded", async () => {
  stubApi({});
  render(<Steps claimId="CLM-1002" />);
  expect(await screen.findByRole("alert")).toBeDefined();
});
