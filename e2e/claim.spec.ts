import { type APIRequestContext, expect, test } from "@playwright/test";
import { BACKEND } from "./helpers";

async function post(
  request: APIRequestContext,
  path: string,
  data: object,
  status = 200,
) {
  const response = await request.post(`${BACKEND}${path}`, { data });
  expect(response.status()).toBe(status);
  return response;
}

test("a claim's page shows the claim, the policy and the history", async ({
  page,
}) => {
  await page.goto("/#/claims/CLM-1003");
  await expect(page.getByRole("heading", { name: "CLM-1003" })).toBeVisible();
  await expect(page.getByText("No decision yet")).toBeVisible();
  await expect(page.getByText(/slipped on wet cobblestones/)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /Emergency room visit, X-rays/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Hospital itemized bill/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Medical report/ }),
  ).toBeVisible();
  const policy = page.getByRole("region", { name: /The policy/ });
  await expect(policy.getByText("UnderCover Premium")).toBeVisible();
  await expect(
    policy.getByText(/^Lisbon, Portugal, Jun 22, 2026/),
  ).toBeVisible();
  const customer = page.getByRole("region", { name: "The customer" });
  await expect(customer.getByText("Aiko Tanaka")).toBeVisible();
  await expect(customer.getByText("No earlier claims")).toBeVisible();
});

test("a step posted while the page is open appears without a reload", async ({
  page,
  request,
}) => {
  await page.goto("/#/claims/CLM-1005");
  await expect(
    page.getByText("The agent hasn't started this claim."),
  ).toBeVisible();
  await post(request, "/api/claims/CLM-1005/steps", {
    thread_id: "e2e",
    kind: "message",
    detail: "Checking the passport claim.",
  });
  await expect(page.getByText("Checking the passport claim.")).toBeVisible({
    timeout: 5000,
  });
});

test("a handler signs off and pays an approval over the limit", async ({
  page,
  request,
}) => {
  const claim = "/api/claims/CLM-1002";
  await post(request, `${claim}/start`, { thread_id: "e2e" });
  await post(request, `${claim}/decision`, {
    decision: "approve",
    payout: 1150,
    reason: "Northwind lost the bag and paid $400. The rest is covered.",
    policy_section: "Section 5, Baggage and Personal Effects",
  });
  const refused = await post(
    request,
    `${claim}/payment`,
    { amount: 1150 },
    409,
  );
  const { detail } = (await refused.json()) as { detail: string };
  await post(request, `${claim}/steps`, {
    thread_id: "e2e",
    kind: "result",
    detail: `pay_claim: Refused: ${detail}`,
  });

  await page.goto("/#/claims/CLM-1002");
  const heading = page.locator(".page-heading");
  await expect(heading.getByText("Waiting for sign-off")).toBeVisible();
  await expect(page.getByText("Refused", { exact: true })).toBeVisible();

  await page
    .getByLabel("Handler")
    .selectOption({ label: "Dana Whitfield, Senior Claims Handler" });
  await page
    .getByRole("button", { name: "Sign off and pay $1,150.00" })
    .click();
  await expect(heading.getByText("Decided")).toBeVisible();
  await expect(page.getByText("Signed off by Dana Whitfield")).toBeVisible();
  await expect(page.getByText("Paid $1,150.00")).toBeVisible();

  await page.getByRole("link", { name: "Queue", exact: true }).click();
  const row = page.getByRole("row", { name: /CLM-1002/ });
  await expect(row.getByText("Decided")).toBeVisible();
});
