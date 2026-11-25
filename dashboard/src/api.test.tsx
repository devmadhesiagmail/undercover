import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getJson, postJson, useJson } from "./api";
import { reply, stubApi } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("posts JSON and returns the response", async () => {
  const fetchMock = stubApi({ "POST /api/thing": { ok: true } });
  expect(await postJson("/api/thing", { amount: 420 })).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith("/api/thing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 420 }),
  });
});

it("throws the backend's reason when it refuses", async () => {
  stubApi({ "/api/claims/CLM-9999": reply(404, { detail: "No claim" }) });
  await expect(getJson("/api/claims/CLM-9999")).rejects.toThrow("No claim");
});

it("throws the status when there is no reason", async () => {
  stubApi({ "/api/bad": reply(422, { detail: [{ msg: "Bad" }] }) });
  await expect(getJson("/api/bad")).rejects.toThrow(
    "The request failed with status 422",
  );
});

it("polls every interval", async () => {
  vi.useFakeTimers();
  const fetchMock = stubApi({ "/api/claims": [] });
  const { result } = renderHook(() => useJson("/api/claims", 2000));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(result.current.data).toEqual([]);
  await act(() => vi.advanceTimersByTimeAsync(4000));
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("loads once without an interval, and again on reload", async () => {
  const fetchMock = stubApi({ "/api/instructions": { instructions: "Hi" } });
  const { result } = renderHook(() => useJson("/api/instructions", null));
  await waitFor(() => {
    expect(result.current.data).toEqual({ instructions: "Hi" });
  });
  act(() => {
    result.current.reload();
  });
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it("keeps the error when loading fails", async () => {
  stubApi({});
  const { result } = renderHook(() => useJson("/api/claims", null));
  await waitFor(() => {
    expect(result.current.error).toBe("Error: No route /api/claims");
  });
  expect(result.current.data).toBeUndefined();
});
