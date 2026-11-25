import { expect, test } from "@playwright/test";

test("the instructions page shows the policy wording", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Instructions" }).click();
  await expect(
    page.getByRole("heading", { name: "The agent's instructions" }),
  ).toBeVisible();
  await expect(page.getByText("Read only")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "UnderCover Travel Insurance: Policy Wording",
    }),
  ).toBeVisible();
  await expect(page.getByText(/^Version 2026\.1/)).toBeVisible();
});
