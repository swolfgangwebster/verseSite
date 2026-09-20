import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function signIn(page: Page, name: string) {
  await page.goto("/signin");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page.getByRole("heading", { name: "A little space for the Word." }),
  ).toBeVisible();
}

test("friends-only reflection flows through actual UI and denies strangers and guests", async ({
  page,
  browser,
}) => {
  await signIn(page, "Ruth Ellis");
  await page.goto("/bible");
  await page.getByLabel("Find a passage").fill("Jn 3:16");
  await page.getByRole("button", { name: "Open passage" }).click();
  await expect(page.locator(".passage-text")).toContainText(
    "For God so loved the world",
  );
  await page.getByRole("link", { name: "Reflect on this" }).click();
  const body = `A thoughtful conversation with friends ${Date.now()}. Learning to listen with kindness.`;
  await page.getByLabel("Your reflection", { exact: true }).fill(body);
  await page.getByLabel("My friends", { exact: false }).check();
  await page.getByRole("button", { name: "Publish reflection" }).click();
  await expect(page.locator(".reflection-body.full")).toHaveText(body);
  await expect(page.locator(".privacy.friends")).toHaveText("Friends");
  const url = page.url();

  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  await friend.goto("http://localhost:3100/signin");
  await friend.getByRole("button", { name: /Jonah Brooks/ }).click();
  await expect(
    friend.getByRole("heading", { name: "A little space for the Word." }),
  ).toBeVisible();
  await friend.goto(url);
  await expect(friend.locator(".reflection-body.full")).toHaveText(body);
  await friend
    .getByRole("button", { name: "Thoughtful 0", exact: true })
    .click();
  await expect(
    friend.getByRole("button", { name: "Thoughtful 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await friendContext.close();

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto("http://localhost:3100/signin");
  await stranger.getByRole("button", { name: /Maya Chen/ }).click();
  await expect(
    stranger.getByRole("heading", { name: "A little space for the Word." }),
  ).toBeVisible();
  await stranger.goto(url);
  await expect(
    stranger.getByRole("heading", { name: "This reflection isn’t available." }),
  ).toBeVisible();
  await expect(stranger.locator("body")).not.toContainText(body);
  await strangerContext.close();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(url);
  await expect(
    guest.getByRole("heading", { name: "This reflection isn’t available." }),
  ).toBeVisible();
  await expect(guest.locator("body")).not.toContainText(body);
  await guestContext.close();
});

test("draft survives refresh, defaults remain private, and account theme persists", async ({
  page,
}) => {
  await signIn(page, "Ruth Ellis");
  await page.goto("/write?reference=Micah%206%3A8");
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("An unfinished thought, kept safely through a refresh.");
  await expect(page.getByRole("radio", { name: /Only me/ })).toBeChecked();
  await page.reload();
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    "An unfinished thought, kept safely through a refresh.",
  );
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Quiet night" }).check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Quiet night" })).toBeChecked();
});

test("responsive light and dark screens render without overflow or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  mkdirSync("artifacts", { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(
      (value) => localStorage.setItem("stillword-theme", value),
      theme,
    );
    for (const viewport of [
      { width: 1440, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ["/", "/bible", "/shop"]) {
        await page.goto(route);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (route === "/")
          await expect(page.locator(".passage-text")).toBeVisible();
        if (route === "/bible")
          await expect(page.locator(".book-grid a")).toHaveCount(66);
        if (route === "/shop") {
          await expect(page.locator(".product-card")).toHaveCount(8);
          await expect(
            page
              .getByRole("button", { name: "Sample · checkout unavailable" })
              .first(),
          ).toBeDisabled();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `artifacts/${route === "/" ? "home" : route.slice(1)}-${theme}-${viewport.width}.png`,
          fullPage: true,
        });
      }
    }
  }
  expect(errors).toEqual([]);
});

test("guest theme persists and mobile navigation opens with keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".passage-text")).toBeVisible();
  await page
    .getByRole("button", { name: "Toggle light and dark theme" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(
    page.getByRole("link", { name: "Friends", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Friends", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Good company for the journey." }),
  ).toBeVisible();
});

test("account pages and moderation remain usable in both themes on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Eden Steward");
  for (const theme of ["light", "dark"]) {
    const saved = await page.request.patch("/api/settings", {
      headers: { origin: "http://localhost:3100" },
      data: { theme },
    });
    expect(saved.ok()).toBe(true);
    for (const viewport of [
      { width: 1440, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of [
        "write",
        "reflections",
        "friends",
        "settings",
        "moderation",
      ]) {
        await page.goto(`/${route}`);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (route === "write")
          await expect(
            page.getByLabel("Your reflection", { exact: true }),
          ).toBeVisible();
        if (route === "moderation")
          await expect(page.locator(".moderation-card")).toHaveCount(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (["write", "friends", "settings"].includes(route))
          await page.screenshot({
            path: `artifacts/${route}-${theme}-${viewport.width}.png`,
            fullPage: true,
          });
      }
    }
  }
  expect(errors).toEqual([]);
});
