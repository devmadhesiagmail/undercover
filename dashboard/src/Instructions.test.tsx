import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Instructions } from "./Instructions";
import { stubApi } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const text = `# The UnderCover Agent

You work **one claim** at a time with \`get_claim\`.

## How to work a claim

1. Read the claim.
2. Approve, decline or refer it:
   - Approve it when it's covered.
   - Decline it when it isn't.

- A bullet

| Benefit | Economy | Premium |
|---|---|---|
| Deductible | $100 | $50 |
`;

it("shows the instructions as a read-only document", async () => {
  stubApi({ "/api/instructions": { instructions: text } });
  render(<Instructions />);
  expect(
    await screen.findByRole("heading", { name: "The UnderCover Agent" }),
  ).toBeDefined();
  expect(screen.getByText("Read only")).toBeDefined();
  expect(
    screen.getByRole("heading", { level: 3, name: "How to work a claim" }),
  ).toBeDefined();
});

it("shows bold, code, lists and tables", async () => {
  stubApi({ "/api/instructions": { instructions: text } });
  render(<Instructions />);
  expect((await screen.findByText("one claim")).tagName).toBe("STRONG");
  expect(screen.getByText("get_claim").tagName).toBe("CODE");
  const lists = screen.getAllByRole("list");
  expect(lists.map((list) => list.tagName)).toEqual(["OL", "UL", "UL"]);
  expect(screen.getByText("Approve it when it's covered.").tagName).toBe("LI");
  expect(screen.getByRole("columnheader", { name: "Economy" })).toBeDefined();
  expect(screen.getByRole("cell", { name: "$50" })).toBeDefined();
});

it("says when the instructions can't be loaded", async () => {
  stubApi({});
  render(<Instructions />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Can't load this page.",
  );
});
