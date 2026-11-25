import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { claimRoutes, stubApi, waitingForSignOff } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function show(hash: string) {
  window.location.hash = hash;
  stubApi({
    "/api/claims": [],
    "/api/instructions": { instructions: "Hi" },
    ...claimRoutes(waitingForSignOff, []),
  });
  render(<App />);
}

it("shows the queue by default", async () => {
  show("");
  expect(
    await screen.findByRole("heading", { name: "Claims queue" }),
  ).toBeDefined();
  expect(
    screen.getByRole("link", { name: "Queue" }).getAttribute("aria-current"),
  ).toBe("page");
});

it("shows the instructions", async () => {
  show("#/instructions");
  expect(
    await screen.findByRole("heading", { name: "The agent's instructions" }),
  ).toBeDefined();
  expect(
    screen
      .getByRole("link", { name: "Instructions" })
      .getAttribute("aria-current"),
  ).toBe("page");
});

it("shows a claim", async () => {
  show("#/claims/CLM-1002");
  expect(
    await screen.findByRole("heading", { name: "CLM-1002" }),
  ).toBeDefined();
});

it("says when a page doesn't exist", () => {
  show("#/nowhere");
  expect(screen.getByRole("heading", { name: "Page not found" })).toBeDefined();
});

it("follows the hash as it changes", async () => {
  show("#/");
  await screen.findByRole("heading", { name: "Claims queue" });
  act(() => {
    window.location.hash = "#/instructions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(
    await screen.findByRole("heading", { name: "The agent's instructions" }),
  ).toBeDefined();
});
