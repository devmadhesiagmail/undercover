import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SignOff } from "./SignOff";
import { handlers, reply, stubApi, waitingForSignOff } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function posts(fetchMock: ReturnType<typeof stubApi>) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([path, init]) => [path, init?.body]);
}

it("offers only the handlers who can approve over the limit", async () => {
  stubApi({ "/api/handlers": handlers });
  render(<SignOff claim={waitingForSignOff} onDone={vi.fn()} />);
  await screen.findByRole("option", {
    name: "Dana Whitfield, Senior Claims Handler",
  });
  expect(screen.queryByRole("option", { name: /Sam Trainee/ })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Sign off and pay $1,150.00",
    }).disabled,
  ).toBe(true);
});

it("signs off as the chosen handler, then pays the payout", async () => {
  const fetchMock = stubApi({
    "/api/handlers": handlers,
    "POST /api/claims/CLM-1002/sign-off": {},
    "POST /api/claims/CLM-1002/payment": {},
  });
  const onDone = vi.fn();
  render(<SignOff claim={waitingForSignOff} onDone={onDone} />);
  await screen.findByRole("option", { name: /Dana Whitfield/ });
  fireEvent.change(screen.getByLabelText("Handler"), {
    target: { value: "HND-01" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Sign off and pay $1,150.00" }),
  );
  await waitFor(() => {
    expect(onDone).toHaveBeenCalled();
  });
  expect(posts(fetchMock)).toEqual([
    ["/api/claims/CLM-1002/sign-off", JSON.stringify({ handler_id: "HND-01" })],
    ["/api/claims/CLM-1002/payment", JSON.stringify({ amount: 1150 })],
  ]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows a refusal and doesn't pay", async () => {
  const fetchMock = stubApi({
    "/api/handlers": handlers,
    "POST /api/claims/CLM-1002/sign-off": reply(409, {
      detail: "CLM-1002 is decided",
    }),
  });
  render(<SignOff claim={waitingForSignOff} onDone={vi.fn()} />);
  await screen.findByRole("option", { name: /Dana Whitfield/ });
  fireEvent.change(screen.getByLabelText("Handler"), {
    target: { value: "HND-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Sign off and pay/ }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "CLM-1002 is decided",
  );
  expect(posts(fetchMock)).toHaveLength(1);
});

it("pays a claim that was signed off but not paid", async () => {
  const fetchMock = stubApi({
    "/api/handlers": handlers,
    "POST /api/claims/CLM-1002/payment": {},
  });
  const signedOff = {
    ...waitingForSignOff,
    status: "decided" as const,
    sign_off: {
      handler_id: "HND-01",
      handler_name: "Dana Whitfield",
      signed_off_at: "2026-11-25T03:50:00+00:00",
    },
  };
  const onDone = vi.fn();
  render(<SignOff claim={signedOff} onDone={onDone} />);
  expect(screen.queryByLabelText("Handler")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pay $1,150.00" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalled();
  });
  expect(posts(fetchMock)).toEqual([
    ["/api/claims/CLM-1002/payment", JSON.stringify({ amount: 1150 })],
  ]);
});
