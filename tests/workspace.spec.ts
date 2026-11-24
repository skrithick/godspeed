import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { exampleWorkspace } from "./fixtures/workspace";
import { paragraph, recordsFor } from "../src/workspace/model";

async function loadExample(page: Page, backup = exampleWorkspace()) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace data" }).click();
  await page.getByLabel("Select Godspeed backup file").setInputFiles({
    name: "test-workspace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole("textbox", { name: "Restore confirmation" }).fill("RESTORE");
  await page.getByRole("button", { name: "Replace workspace" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const readMarker = (element: Locator) => element.evaluate((node) => {
  const marker = getComputedStyle(node, "::before");
  return [marker.width, marker.height, marker.borderRadius, marker.backgroundColor, marker.position];
});

async function chooseOption(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("creates, edits, and searches a nested page across a warm offline reload", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Thinking Machine", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Travel");
  await chooseOption(page, page.getByRole("combobox", { name: "Type", exact: true }), "Folder");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Travel");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Offline itinerary");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#page\//);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Travel", exact: true })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Page content" });
  await editor.click();
  await editor.pressSequentially("/heading 2");
  await expect(page.getByRole("button", { name: "Heading 2 Small section heading" })).toBeVisible();
  await editor.press("Enter");
  await editor.pressSequentially("Overnight railway research");
  await expect(editor.locator("h2")).toHaveText("Overnight railway research");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const keys = await (await caches.open("godspeed-assets-v1")).keys();
    const scripts = [...document.scripts].map((s) => s.src).filter((src) => src.includes("/_next/static/"));
    return scripts.length > 0 && scripts.every((script) => keys.some((key) => key.url === script));
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Offline mode", { exact: true })).toHaveCount(0);
  await expect(editor).toContainText("Overnight railway research");
  await editor.press("End");
  await editor.pressSequentially(" in Europe");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search query" }).fill("railway");
  await expect(page.getByRole("dialog").getByRole("option", { name: /Offline itinerary/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("in Europe");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor).toContainText("in Europe");
});

test("shares a task across table, board, and calendar", async ({ page }) => {
  await page.goto("/#tasks");
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Task name" }).fill("Find a train ticket");
  const current = new Date();
  const date = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-15`;
  await page.getByLabel("Due date", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("button", { name: "Find a train ticket" })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: /Find a train ticket/ }).click();
  await chooseOption(page, page.getByRole("dialog", { name: "Task details" }).getByRole("combobox", { name: "Status", exact: true }), "In progress");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.locator(".board-column").filter({ has: page.getByRole("heading", { name: /In progress/ }) }).getByRole("button", { name: /Find a train ticket/ })).toBeVisible();
  await page.locator(".tabs").getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find a train ticket" })).toBeVisible();
});

test("runs a local command, inspects the tool, approves and undoes a proposal", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Your Thinking Machine", exact: true }).waitFor();
  await page.keyboard.press("Control+j");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("Create a page called Agent notes");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Agent Chat" })).toBeVisible();
  await page.locator(".chat-activity summary").click();
  await page.getByRole("button", { name: /propose.change/ }).click();
  await expect(page.getByRole("dialog").getByText(/awaiting_user_approval/)).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Pages and folders" }).getByText("Agent notes")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve & apply" }).click();
  await expect(page.getByRole("navigation", { name: "Pages and folders" }).getByText("Agent notes")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Undo change" })).toBeVisible();
  await page.getByRole("button", { name: "Undo change" }).click();
  await page.getByRole("button", { name: "Confirm undo" }).click();
  await expect(page.getByText("Undone", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pages and folders" }).getByText("Agent notes")).toHaveCount(0);
});

test("keeps the mobile shell usable and persists theme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Thinking Machine", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const navigationTrigger = page.getByRole("button", { name: "Open navigation" });
  await navigationTrigger.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(navigationTrigger).toBeFocused();
  const search = page.getByRole("button", { name: "Search workspace" });
  await search.click();
  await expect(page.getByRole("combobox", { name: "Search query" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();

  await navigationTrigger.click();
  await drawer.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Workspace settings" })).toBeVisible();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(navigationTrigger).toBeFocused();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Your Thinking Machine", exact: true })).toBeVisible();
});

test("exports a usable backup and requires explicit confirmation to restore it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace data" }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^godspeed-backup-.*\.json$/);
  const bytes = await readFile((await download.path())!);
  expect(JSON.parse(bytes.toString())).toMatchObject({ format: "godspeed-workspace", version: 1 });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("After the backup");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Pages and folders" });
  await expect(nav.getByRole("link", { name: "After the backup", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace data" }).click();
  await page.getByLabel("Select Godspeed backup file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes });
  const replace = page.getByRole("button", { name: "Replace workspace" });
  await expect(replace).toBeDisabled();
  await page.getByRole("textbox", { name: "Restore confirmation" }).fill("RESTORE");
  await replace.click();
  await expect(page.getByText("Workspace restored.", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "After the backup", exact: true })).toHaveCount(0);
});

test("updates the brand and carries same-origin data forward from Atlas", async ({ page }) => {
  await page.route("**/upgrade-fixture", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Upgrade fixture</title>" }));
  await page.goto("/upgrade-fixture");
  await page.evaluate(async ({ pages, blocks, databases, tasks }) => {
    localStorage.setItem("atlas-theme", "dark");
    localStorage.setItem("atlas-ai-enabled", "true");
    sessionStorage.setItem("atlas-draft:old-workspace:project-brief", JSON.stringify({
      id: "legacy-draft", revision: 0, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A draft from before the rename." }] }] },
    }));
    const rows = { pages, blocks, databases, tasks, meta: [{ key: "workspace", value: "old-workspace" }], runs: [] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("atlas-workspace", 10);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [name, values] of Object.entries(rows)) {
          const keyPath = name === "blocks" ? ["pageId", "id"] : name === "meta" ? "key" : "id";
          const store = db.createObjectStore(name, { keyPath });
          for (const row of values) store.add(row);
        }
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    await caches.open("atlas-shell-v1");
    await caches.open("unrelated-cache");
  }, exampleWorkspace());

  await page.goto("/#page/project-brief");
  await expect(page).toHaveTitle(/Godspeed/);
  await expect(page.getByRole("link", { name: "Godspeed overview" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Project brief");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("Recovered local draft")).toBeVisible();
  expect(await page.evaluate(() => [
    localStorage.getItem("godspeed-theme"),
    localStorage.getItem("godspeed-ai-enabled"),
    Boolean(sessionStorage.getItem("godspeed-draft:old-workspace:project-brief")),
  ])).toEqual(["dark", "true", true]);
  const logo = page.getByRole("link", { name: "Godspeed overview" });
  await expect(logo).toHaveCSS("font-family", /Fraunces Variable/);
  await expect(logo.locator("svg, img")).toHaveCount(0);
  const icon = await page.request.get("/icon.svg");
  expect(await icon.text()).toContain("#bddf77");
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(["godspeed-shell-v1", "unrelated-cache"]));
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("atlas-shell-v1");
});

test("finds views by keyboard and browses folders, with real links back through the hierarchy", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("heading", { name: "Your Thinking Machine", exact: true }).waitFor();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search query" });
  await expect(search).toBeFocused();
  await search.fill("calendar");
  const calendar = page.getByRole("option", { name: "Calendar My tasks", exact: true });
  await expect(calendar).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveAttribute("aria-activedescendant", (await calendar.getAttribute("id"))!);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#tasks\/calendar$/);
  await expect(page.getByRole("region", { name: "Task calendar" })).toBeVisible();

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Workspace" }).click();
  const browse = page.getByRole("button", { name: "Browse pages" });
  await browse.click();
  const filter = page.getByRole("combobox", { name: "Filter pages" });
  await expect(filter).toBeFocused();
  await expect(page.getByRole("option", { name: /Knowledge base Folder/ })).toBeVisible();
  await expect(page.getByRole("option", { name: "Calendar My tasks", exact: true })).toHaveCount(0);
  await filter.fill("Project brief");
  await expect(page.getByRole("option", { name: /Project brief/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("href", "#page/projects");
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Project brief");
  await page.getByRole("button", { name: "Collapse Projects" }).click();
  await expect(page.getByRole("navigation", { name: "Pages and folders" }).getByRole("link", { name: "Project brief", exact: true })).toHaveCount(0);
  await breadcrumb.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("link", { name: "Project brief", exact: true }).last()).toHaveAttribute("href", "#page/project-brief");
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/#page/project-brief");
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Project brief");
  await expect(breadcrumb.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("keeps core text, field boundaries and keyboard focus legible in both themes", async ({ page }) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  for (const theme of ["Light", "Dark"]) {
    await settings.click();
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const ratios = await page.evaluate(() => {
      const tokens = getComputedStyle(document.documentElement);
      const luminance = (name: string) => {
        const hex = tokens.getPropertyValue(`--${name}`).trim().replace("#", "");
        const expanded = hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex;
        const channels = expanded.match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255)
          .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
      };
      const contrast = (a: string, b: string) => {
        const lums = [luminance(a), luminance(b)];
        return (Math.max(...lums) + .05) / (Math.min(...lums) + .05);
      };
      return {
        text: Math.min(contrast("ink", "canvas"), contrast("quiet", "canvas"), contrast("quiet", "sidebar"), contrast("quiet", "panel"),
          contrast("action-ink", "action"), contrast("action-ink", "action-hover"), contrast("accent", "accent-soft"), contrast("accent", "canvas")),
        controls: Math.min(contrast("control-line", "solid"), contrast("focus", "canvas"), contrast("focus", "sidebar"), contrast("focus", "panel"),
          contrast("action-edge", "canvas"), contrast("accent", "selected"), contrast("accent-hover", "panel")),
      };
    });
    expect(ratios.text, `${theme} text contrast`).toBeGreaterThanOrEqual(4.5);
    expect(ratios.controls, `${theme} field and focus contrast`).toBeGreaterThanOrEqual(3);
  }
});

test("uses Geist and Geist Mono locally and matches the palette’s sidebar selection marker", async ({ page }) => {
  await page.goto("/");
  const overview = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" });
  await expect(overview).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("body")).toHaveCSS("font-family", /Geist Variable/);
  await expect(page.locator(".nav-search kbd")).toHaveCSS("font-family", /Geist Mono Variable/);
  const loaded = await page.evaluate(() => [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family));
  expect(loaded).toEqual(expect.arrayContaining(["Geist Variable", "Geist Mono Variable"]));
  const sidebarMarker = await readMarker(overview);
  await page.keyboard.press("Control+k");
  const active = page.getByRole("option", { name: "Overview" });
  await expect(active).toHaveAttribute("aria-selected", "true");
  expect(sidebarMarker.slice(0, 3)).toEqual(["2px", "16px", "1px"]);
  expect(await readMarker(active)).toEqual(sidebarMarker);
});

test("emphasizes the weekday labels and highlights today’s column only in the current month", async ({ page }) => {
  await page.goto("/#calendar");
  const weekdays = page.locator(".calendar-weekday");
  await expect(weekdays).toHaveCount(7);
  const weekdayStrip = page.locator(".calendar-weekdays");
  await expect(weekdayStrip).toHaveCSS("border-bottom-width", "1px");
  await expect(weekdays.first()).toHaveCSS("border-inline-end-width", "1px");
  await expect(weekdays.last()).toHaveCSS("border-inline-end-width", "0px");
  await expect(weekdays.first()).toHaveCSS("text-transform", "uppercase");
  const calendarSurface = await page.getByRole("region", { name: "Task calendar" }).evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(weekdayStrip).not.toHaveCSS("background-color", calendarSurface);
  const current = page.locator(".calendar-weekday[data-current]");
  const name = await page.evaluate(() => new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date()));
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("title", name);
  await expect(current).toHaveCSS("font-family", /Geist Mono Variable/);
  const todayCell = page.locator('.calendar-day[aria-current="date"]');
  await expect(todayCell).toBeVisible();
  await expect(todayCell.locator(":scope > svg")).toHaveCSS("background-color", calendarSurface);
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(current).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(current).toHaveAttribute("title", name);
  await page.setViewportSize({ width: 320, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(weekdays.first()).toBeVisible();
  await expect(weekdays.last()).toBeVisible();
});

test("opens page options by right-click and keyboard without losing rename or deletion safeguards", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (text: string) => {
      document.body.dataset.copied = text;
      return Promise.resolve();
    } } });
  });
  await loadExample(page);
  const recentlyEdited = page.getByRole("region", { name: "Recently edited" });
  const sidebarMarker = await readMarker(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }));
  await recentlyEdited.getByRole("link", { name: /Project brief/ }).click({ button: "right" });
  const renameItem = page.getByRole("menuitem", { name: "Rename", exact: true });
  await expect(renameItem).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body, "::after").backdropFilter)).toBe("blur(3px)");
  await renameItem.hover();
  await expect(renameItem).toHaveAttribute("data-highlighted", "");
  expect(await readMarker(renameItem)).toEqual(sidebarMarker);
  await renameItem.click();
  const rename = page.getByRole("dialog", { name: "Rename page" });
  await rename.getByRole("textbox", { name: "Title" }).fill("Launch brief");
  await rename.getByRole("button", { name: "Save name" }).click();
  const renamed = recentlyEdited.getByRole("link", { name: /Launch brief/ });
  await expect(renamed).toHaveAttribute("href", "#page/project-brief");
  await expect(page.getByRole("heading", { name: "Your Thinking Machine", exact: true })).toBeVisible();
  await renamed.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Options for Launch brief" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-copied", /#page\/project-brief$/);
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  await expect(page.getByRole("navigation", { name: "Favorites" }).getByRole("link", { name: "Launch brief" })).toBeVisible();
  await page.getByRole("navigation", { name: "Pages and folders" }).getByRole("link", { name: "Projects" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete folder/ }).click();
  const deletion = page.getByRole("dialog", { name: "Delete folder?" });
  await expect(deletion.getByRole("button", { name: "Delete folder", exact: true })).toBeDisabled();
  await deletion.getByRole("button", { name: "Cancel" }).click();
  await expect(renamed).toBeVisible();
});

test("changes task status from a context menu and requires confirmation before deleting", async ({ page }) => {
  await loadExample(page);
  await page.goto("/#tasks");
  const title = "Review the project brief";
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByText("In progress", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Set status" }).hover();
  await page.getByRole("menuitem", { name: "Done", exact: true }).click();
  await expect(row.getByText("Done", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const done = page.locator(".board-column").filter({ has: page.getByRole("heading", { name: /^Done/ }) });
  const card = done.getByRole("button", { name: new RegExp(title) });
  await card.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: `Options for ${title}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Database views" }).getByRole("button", { name: "Calendar" }).click();
  const calendarTask = page.getByRole("button", { name: title, exact: true });
  await calendarTask.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete task/ }).click();
  const details = page.getByRole("dialog", { name: "Task details" });
  await expect(details.getByText("Delete this task permanently?")).toBeVisible();
  await details.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(calendarTask).toBeVisible();
  await calendarTask.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete task/ }).click();
  await details.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(calendarTask).toHaveCount(0);
});

test("shows an empty workspace by default and saves the icon picked when creating a page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No pages yet. Create one to start writing.")).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "Pages and folders" });
  await expect(sidebar.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Favorites" })).toHaveCount(0);
  await page.goto("/#tasks");
  await expect(page.getByText("No tasks yet. Add one to start planning.")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
  await page.getByRole("button", { name: "New page", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create in workspace" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Reading list");
  await expect(dialog.getByRole("radio", { name: "Document", exact: true })).toBeChecked();
  const type = dialog.getByRole("combobox", { name: "Type", exact: true });
  await chooseOption(page, type, "Folder");
  await expect(dialog.getByRole("radio", { name: "Folder", exact: true })).toBeChecked();
  await chooseOption(page, type, "Page");
  const book = dialog.getByRole("radio", { name: "Book", exact: true });
  await dialog.getByTitle("Book", { exact: true }).click();
  await expect(book).toBeChecked();
  await book.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Compass", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue("Reading list");
  await expect(page.locator(".page-kind .lucide-compass")).toBeVisible();
  await page.reload();
  await expect(sidebar.getByRole("link", { name: "Reading list" }).locator(".lucide-compass")).toBeVisible();
  await expect(sidebar.getByRole("link")).toHaveCount(1);
});

test("resets a populated workspace only after confirmation and stays blank on reload", async ({ page }) => {
  await loadExample(page);
  const tree = page.getByRole("navigation", { name: "Pages and folders" });
  await expect(tree.getByRole("link", { name: "Projects" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("godspeed-draft:old:page", "{}"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Workspace data" }).click();
  await page.getByRole("button", { name: "Reset workspace", exact: true }).click();
  const clear = page.getByRole("button", { name: "Clear all data", exact: true });
  await expect(clear).toBeDisabled();
  await page.getByRole("textbox", { name: "Reset confirmation" }).fill("RESET");
  await clear.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tree.getByRole("link")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("godspeed-draft:old:page"))).toBeNull();
  await page.reload();
  await expect(page.getByText("No pages yet. Create one to start writing.")).toBeVisible();
  await expect(tree.getByRole("link")).toHaveCount(0);
  await expect(page.getByText("Local workspace", { exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My tasks" }).click();
  await expect(page.getByText("No tasks yet. Add one to start planning.")).toBeVisible();
});

test("keeps the headline clear of the artwork and remembers the desktop sidebar preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const title = page.getByRole("heading", { name: "Your Thinking Machine" });
  const art = page.locator(".trajectory");
  const checkLayout = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const text = (await title.boundingBox())!;
    const image = (await art.boundingBox())!;
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(text.x + text.width <= image.x + 1 || text.y + text.height <= image.y + 1).toBe(true);
  };
  await expect(title).toBeVisible();
  for (const width of [320, 621, 821, 1024, 1440]) await checkLayout(width);
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(sidebar.getByRole("button", { name: "Expand sidebar" })).toBeFocused();
  await expect(sidebar.getByRole("button", { name: "Search workspace", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Browse pages", exact: true })).toBeVisible();
  await sidebar.getByRole("link", { name: "My tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My tasks", exact: true })).toBeVisible();
  await page.reload();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveCSS("width", "64px");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(sidebar.getByRole("link", { name: "Godspeed overview" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expand.click();
  await expect(sidebar).toHaveCSS("width", "236px");
});

test("resizes the desktop sidebar by pointer and keyboard and keeps its width after reload", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const resize = page.getByRole("separator", { name: "Sidebar width" });
  await expect(resize).toHaveAttribute("aria-valuenow", "236");
  const box = (await resize.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, 120);
  await page.mouse.down();
  await page.mouse.move(x + 58, 120, { steps: 5 });
  await page.mouse.up();
  await expect(resize).toHaveAttribute("aria-valuenow", "294");
  await resize.press("ArrowRight");
  await expect(resize).toHaveAttribute("aria-valuenow", "302");
  await page.reload();
  await expect(resize).toHaveAttribute("aria-valuenow", "302");
  await resize.press("End");
  await expect(resize).toHaveAttribute("aria-valuenow", "380");
});

test("navigates settings by keyboard and keeps the radial pattern across workspace views", async ({ page }) => {
  await page.goto("/");
  const pattern = page.locator("#workspace-main .workspace-pattern");
  await expect(pattern).toBeVisible();
  await page.getByRole("link", { name: "My tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My tasks", exact: true })).toBeVisible();
  await expect(pattern).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const appearance = page.getByRole("tab", { name: "Appearance" });
  await expect(appearance).toHaveAttribute("aria-selected", "true");
  await appearance.press("ArrowDown");
  await expect(page.getByRole("tabpanel", { name: "AI provider" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "AI provider" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel", { name: "Workspace data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export backup" })).toBeVisible();
});

test("shows readable calendar tasks in a mobile month agenda", async ({ page }) => {
  await loadExample(page);
  await page.goto("/#tasks/calendar");
  await page.setViewportSize({ width: 320, height: 780 });
  const agenda = page.getByRole("region", { name: "Tasks this month" });
  await expect(agenda.getByRole("button", { name: "Review the project brief", exact: true })).toBeVisible();
  await agenda.getByRole("button", { name: "Review the project brief", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
});

test("uses the chat composer to infer a workspace search, follow up, and reopen the conversation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Cedar launch notes");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("link", { name: "Agent Chat", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "Message Godspeed" });
  await composer.fill("What do we have on Cedar?");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Cedar launch notes", exact: true })).toBeVisible();
  await composer.fill("Outline it");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("I found the saved page outline.", { exact: false })).toBeVisible();
  await page.reload();
  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation.getByText("What do we have on Cedar?", { exact: true })).toBeVisible();
  await expect(conversation.getByText("Outline it", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(conversation).toHaveCount(0);
  await page.getByRole("button", { name: "Recent chats" }).click();
  await page.getByRole("menuitem", { name: /Outline it/ }).click();
  await expect(conversation.getByText("What do we have on Cedar?", { exact: true })).toBeVisible();
});

test("keeps dropdowns inside the viewport and returns keyboard focus without dismissing the form", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#tasks/calendar");
  const filter = page.getByRole("combobox", { name: "Filter tasks by status" });
  await filter.press("ArrowDown");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const popupBlur = () => page.evaluate(() => getComputedStyle(document.body, "::after").backdropFilter);
  await expect.poll(popupBlur).toBe("blur(3px)");
  const fit = (await list.boundingBox())!;
  expect(fit.x).toBeGreaterThanOrEqual(0);
  expect(fit.x + fit.width).toBeLessThanOrEqual(320);
  await expect(list.getByRole("option", { name: "All statuses", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(list.getByRole("option", { name: "Done", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(filter).toHaveText("Done");
  await expect(filter).toBeFocused();
  await expect.poll(popupBlur).toBe("none");

  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(page.locator(".dialog-overlay")).toHaveCSS("backdrop-filter", "blur(5px)");
  const priority = dialog.getByRole("combobox", { name: "Priority" });
  await priority.press("ArrowDown");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(priority).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const database = page.getByRole("combobox", { name: "Database", exact: true });
  await chooseOption(page, database, "+ New database");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Planning");
  await dialog.getByRole("button", { name: "Create database" }).click();
  await expect(database).toHaveText("Planning");
});

test("shows only one chat header and keeps its actions readable on phones", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#canvas");
  const header = page.getByRole("banner");
  await expect(header.getByRole("heading", { name: "Agent Chat", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent Chat", exact: true })).toHaveCount(1);
  const newChat = header.getByRole("button", { name: "New chat", exact: true });
  await expect(newChat.locator("svg")).toHaveCount(0);
  await newChat.click();
  await expect(page.getByRole("textbox", { name: "Message Godspeed" })).toBeFocused();
});

test("centers the radial background in the visible workspace with either sidebar state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const pattern = page.locator("svg.workspace-pattern");
  await expect(pattern).toBeVisible();
  const check = () => pattern.evaluate((el: SVGSVGElement) => {
    const viewport = el.closest("main")!.getBoundingClientRect();
    const center = new DOMPoint(600, 380).matrixTransform(el.getScreenCTM()!);
    return Math.max(Math.abs(center.x - (viewport.left + viewport.width / 2)), Math.abs(center.y - (viewport.top + innerHeight) / 2));
  });
  expect(await check()).toBeLessThan(0.5);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(check).toBeLessThan(0.5);
});

test("unifies task views without losing filters or duplicating the create action", async ({ page }) => {
  await loadExample(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
  await page.goto("/#calendar");
  await expect(nav.getByRole("link", { name: "My tasks" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Task calendar" })).toBeVisible();
  const filter = page.getByRole("textbox", { name: "Filter tasks by text" });
  await filter.fill("Review the project brief");
  const views = page.getByRole("group", { name: "Database views" });
  await views.getByRole("button", { name: "Table" }).click();
  await expect(page).toHaveURL(/#tasks$/);
  const row = page.getByRole("row").filter({ hasText: "Review the project brief" });
  await expect(row.getByText("In progress", { exact: true })).toBeVisible();
  await expect(row.getByText("Today", { exact: true })).toBeVisible();
  await expect(row.getByRole("rowheader")).toHaveCSS("position", "sticky");
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(1);
  await views.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/#tasks\/board$/);
  await expect(filter).toHaveValue("Review the project brief");
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(1);
  await page.goBack();
  await expect(row).toBeVisible();
  await expect(filter).toHaveValue("Review the project brief");
});

test("uses ChatGPT plan billing only after a separate workspace consent", async ({ page }) => {
  const account = "oaiapp_test";
  let calls = 0;
  await page.route("**/api/chatgpt", (route) => route.fulfill({ json: {
    available: true, signedIn: true, configured: true, selected: account,
    email: "test@example.com", profiles: [{ id: account, label: "test@example.com" }],
  } }));
  await page.route("**/api/agent", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: { configured: true, model: "api-fixture" } });
      return;
    }
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({ billing: "chatgpt", account });
    await route.fulfill({ contentType: "text/event-stream", headers: { "X-Godspeed-Model": "gpt-6-luna" }, body: [
      'data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"A simulated plan response."}',
      'data: {"type":"response.completed","response":{"output":[]}}',
      "",
    ].join("\n") });
  });
  await page.goto("/?chatgpt=welcome#canvas");
  await expect(page.getByRole("heading", { name: "You’re using your ChatGPT plan" })).toBeVisible();
  const consent = page.getByRole("checkbox", { name: /Allow model requests/ });
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Message Godspeed" });
  await box.fill("Explain swallows in two sentences.");
  await box.press("Enter");
  await expect(page.getByText(/This question needs a model/)).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI provider" }).click();
  await consent.check();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Using ChatGPT plan", { exact: false })).toBeVisible();
  await box.fill("Explain swallows in two sentences.");
  await box.press("Enter");
  await expect(page.getByText("A simulated plan response.", { exact: true })).toBeVisible();
  await expect(page.getByText("gpt-6-luna", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("rejects cross-origin sign-in starts and never falls back to an API key", async ({ request, baseURL }) => {
  const denied = await request.post("/api/chatgpt?action=connect", { headers: { Origin: "https://elsewhere.example" } });
  expect(denied.status()).toBe(403);
  const missing = await request.post("/api/agent", { headers: { Origin: baseURL! },
    data: { billing: "chatgpt", account: "oaiapp_not_signed_in", messages: [{ role: "user", content: "Hello" }] } });
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toMatchObject({ error: expect.stringContaining("Connect a ChatGPT account") });
});

test("selects a model, researches automatically, and saves an approved Markdown draft", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("godspeed-plan-consent", "oaiapp_fixture"));
  await page.route("**/api/chatgpt", (route) => route.fulfill({ json: {
    available: true, signedIn: true, configured: true, selected: "oaiapp_fixture", profiles: [],
  } }));
  await page.route(/\/api\/chatgpt\?models=1&account=oaiapp_fixture$/, (route) => route.fulfill({ json: {
    models: [{ slug: "gpt-6-luna", label: "GPT-6 Luna" }, { slug: "gpt-5.6-luna", label: "GPT-5.6 Luna" }],
  } }));
  let rounds = 0;
  await page.route("**/api/agent", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { configured: false } });
    expect(route.request().postDataJSON()).toMatchObject({ billing: "chatgpt", model: "gpt-5.6-luna", webSearch: rounds === 0 });
    const output = rounds++ === 0 ? [
      { type: "web_search_call", status: "completed" },
      { type: "message", content: [{ type: "output_text", text: "Found a source.", annotations: [
        { type: "url_citation", url: "https://example.org/reference", title: "Reference guide" },
        { type: "url_citation", url: "javascript:alert(1)", title: "Unsafe link" },
      ] }] },
      { type: "function_call", call_id: "call_1", name: "propose_change", arguments: JSON.stringify({
        action: { kind: "create_page", title: "Research brief",
          text: "## Findings\n\nA **strong** result.\n\n| Item | Count |\n| --- | --- |\n| Maps | 2 |\n\n[Reference](https://example.org/reference)" },
      }) },
    ] : [{ type: "message", content: [{ type: "output_text", text: "The draft is ready." }] }];
    return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "response.completed", response: { output } })}\n\n` });
  });
  await page.goto("/#canvas");
  await expect(page.getByText("Using ChatGPT plan", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Web research" })).toHaveCount(0);
  await page.getByRole("button", { name: /Select model: Auto/ }).click();
  await page.getByRole("menuitem", { name: "GPT-5.6 Luna" }).click();
  await expect(page.getByRole("button", { name: "Select model: GPT-5.6 Luna" })).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message Godspeed" });
  await box.fill("Search the web for map references and draft a page.");
  await box.press("Enter");
  await expect(page.getByRole("link", { name: "Reference guide" })).toHaveAttribute("href", "https://example.org/reference");
  await expect(page.getByRole("link", { name: "Unsafe link" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Assistant response" }).getByText("Godspeed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Approve & apply" }).click();
  await page.getByRole("button", { name: "Open result" }).click();
  const editor = page.getByRole("textbox", { name: "Page content" });
  await expect(editor.getByRole("heading", { name: "Findings", level: 2 })).toBeVisible();
  await expect(editor.locator("strong")).toHaveText("strong");
  await editor.getByRole("cell", { name: "Maps" }).locator("p").fill("Charts");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.getByRole("cell", { name: "Charts" })).toBeVisible();
  expect(rounds).toBe(2);
});

test("formats an existing plain Markdown page only on request and supports undo", async ({ page }) => {
  const backup = exampleWorkspace();
  backup.blocks = [...backup.blocks.filter(({ pageId }) => pageId !== "project-brief"), ...recordsFor("project-brief", {
    type: "doc", content: ["## Findings", "", "A **strong** result."].map(paragraph),
  })];
  await loadExample(page, backup);
  await page.goto("/#page/project-brief");
  const editor = page.getByRole("textbox", { name: "Page content" });
  await expect(editor).toContainText("## Findings");
  await page.getByRole("button", { name: "Format Markdown" }).click();
  await expect(editor.getByRole("heading", { name: "Findings", level: 2 })).toBeVisible();
  await editor.press("Control+z");
  await expect(editor).toContainText("## Findings");
});
