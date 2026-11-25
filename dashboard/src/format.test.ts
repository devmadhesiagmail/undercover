import { expect, it } from "vitest";
import { clock, date, decisionLabel, money, words } from "./format";

it("formats money in US dollars", () => {
  expect(money(1250)).toBe("$1,250.00");
  expect(money(420)).toBe("$420.00");
  expect(money(0)).toBe("$0.00");
});

it("formats dates without shifting the day", () => {
  expect(date("2026-06-24")).toBe("Jun 24, 2026");
});

it("formats times of day", () => {
  expect(clock("2026-11-25T03:42:59+00:00")).toMatch(/\d{1,2}:\d{2}:59 [AP]M/);
});

it("turns codes into words", () => {
  expect(words("trip_delay")).toBe("Trip delay");
  expect(words("baggage")).toBe("Baggage");
});

it("labels decisions, with the payout on an approval", () => {
  expect(decisionLabel("approve", 420)).toBe("Approved $420.00");
  expect(decisionLabel("decline", 0)).toBe("Declined");
  expect(decisionLabel("refer", 0)).toBe("Referred");
});
