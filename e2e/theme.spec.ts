import { expect, test } from "@playwright/test";

test.describe("light mode", () => {
  test.use({ colorScheme: "light" });

  test("the page background is light", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(240, 244, 245)",
    );
  });
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the page background is dark", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(4, 35, 46)",
    );
  });
});
