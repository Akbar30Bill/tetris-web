import {expect, test} from "playwright/test";

test("engine and room-code tests pass in a browser", async ({page, baseURL}) => {
  await page.goto(`${baseURL}/tests.html`);
  await expect(page.locator("#summary")).toHaveText(/ALL \d+ TESTS PASSED/);
});

test("host and guest join by room link and start a duel", async ({browser, baseURL}) => {
  const hostContext = await browser.newContext({permissions: ["clipboard-read", "clipboard-write"]});
  const guestContext = await browser.newContext({permissions: ["clipboard-read", "clipboard-write"]});
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto(`${baseURL}/?test=1`);
    await host.getByRole("button", {name: "HOST GAME"}).click();
    await expect(host.locator("#connect-status")).toHaveText("ROOM READY");

    const roomCode = await host.locator("#connect-code").inputValue();
    expect(roomCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{3}$/);

    await guest.goto(`${baseURL}/?test=1#room=${roomCode}`);
    await expect(host.locator("#connect-status")).toHaveText("PLAYER REQUESTING", {timeout: 45000});
    await expect(host.getByRole("button", {name: "ACCEPT PLAYER"})).toBeEnabled();
    await host.getByRole("button", {name: "ACCEPT PLAYER"}).click();
    await expect(host.locator("#game-screen")).toBeVisible({timeout: 45000});
    await expect(guest.locator("#game-screen")).toBeVisible({timeout: 45000});

    await host.getByRole("button", {name: "READY"}).click();
    await guest.getByRole("button", {name: "READY"}).click();

    await expect.poll(() => host.evaluate(() => window.__vitetrisTest.state().stage), {timeout: 10000})
      .toBe("countdown");
    await expect.poll(() => guest.evaluate(() => window.__vitetrisTest.state().stage), {timeout: 10000})
      .toBe("countdown");

    await expect.poll(() => host.evaluate(() => window.__vitetrisTest.state()), {timeout: 10000})
      .toMatchObject({stage: "playing", engineStatus: "running", round: 1});
    await expect.poll(() => guest.evaluate(() => window.__vitetrisTest.state()), {timeout: 10000})
      .toMatchObject({stage: "playing", engineStatus: "running", round: 1});
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
