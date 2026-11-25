import { expect, test } from "@playwright/test";

test("the queue shows 25 claims in order, all waiting", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator("table.queue tbody tr");
  await expect(rows).toHaveCount(25);
  await expect(rows.first().getByRole("link")).toHaveText("CLM-1001");
  await expect(rows.last().getByRole("link")).toHaveText("CLM-1025");
  await expect(
    page.locator("table.queue tbody").getByText("Waiting", { exact: true }),
  ).toHaveCount(25);
});

test("clicking a claim opens its page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "CLM-1001" }).click();
  await expect(page).toHaveURL(/#\/claims\/CLM-1001$/);
  await expect(page.getByRole("heading", { name: "CLM-1001" })).toBeVisible();
});
