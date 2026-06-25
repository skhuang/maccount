import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminHomePage, adminPage, dashboardPage } from "../src/html";
import type { BindingRow } from "../src/csv";
import type { GradeRow } from "../src/db/grades";

const course = { course_id: "ds-2026", name: "資料結構 2026", term: "2026", status: "active" };

const bindings: BindingRow[] = [
  {
    nycu_id: "z99",
    nycu_name: "Zoe",
    github_id: 99,
    github_login: "zoe",
    google_email: "zoe@example.com",
    created_at: "2026-06-24T00:00:00Z",
    updated_at: "2026-06-24T00:00:00Z",
  },
  {
    nycu_id: "a01",
    nycu_name: "Alice",
    github_id: 1,
    github_login: "alice",
    google_email: null,
    created_at: "2026-06-23T00:00:00Z",
    updated_at: "2026-06-23T00:00:00Z",
  },
];

const grade: GradeRow = {
  course_id: "ds-2026",
  student_id: "a01",
  problem_id: "lab01-stack",
  verdict: "AC",
  score: 100,
  max_score: 100,
  updated_at: "2026-06-24T00:00:00Z",
  repo: "alice/lab01-stack",
  assignment_id: "lab01",
  assignment_type: "lab",
  assignment_title: "Lab 1",
};

function adminFixture(): string {
  return adminPage("zh", course, bindings, {
    isOwner: true,
    staff: [],
    enrolled: [
      { student_id: "a01", github_login: "alice", google_email: null },
      { student_id: "z99", github_login: "zoe", google_email: "zoe@example.com" },
    ],
    forms: [{ id: 1, title: "課程回饋", url: "https://forms.example.test/feedback" }],
  });
}

test("admin tables search, filter, sort, and show an empty result", async ({ page }) => {
  await page.setContent(adminFixture(), { waitUntil: "load" });

  const search = page.locator('[data-table-id="course-bindings-table"] [data-table-search]');
  await search.fill("alice");
  await expect(page.locator("#course-bindings-table tbody tr[data-row]:visible")).toHaveCount(1);
  await expect(page.locator("#course-bindings-table tbody tr[data-row]:visible")).toContainText("a01");

  await search.fill("nobody-matches-this");
  await expect(page.locator("#course-bindings-table tr[data-no-results]")).toBeVisible();
  await expect(page.locator('[data-table-id="course-bindings-table"] [data-table-count]')).toContainText("0 / 2");

  await search.clear();
  await page.locator('#course-bindings-table th[data-sort-column="0"] button').click();
  await expect(page.locator("#course-bindings-table tbody tr[data-row]").first().locator("td").first()).toHaveText("a01");
  await expect(page.locator('#course-bindings-table th[data-sort-column="0"]')).toHaveAttribute("aria-sort", "ascending");

  await page.locator("#enrollment summary").click();
  await page.locator('[data-table-id="enrollment-table"] [data-table-status]').selectOption("missing");
  await expect(page.locator("#enrollment-table tbody tr[data-row]:visible")).toHaveCount(1);
  await expect(page.locator("#enrollment-table tbody tr[data-row]:visible")).toContainText("a01");
});

test("prospective-student link can be copied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (value: string) => { (window as Window & { __copied?: string }).__copied = value; return Promise.resolve(); } },
    });
  });
  await page.route("https://maccount.example.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: adminFixture() }),
  );
  await page.goto("https://maccount.example.test/admin");
  await page.locator('[data-copy-path="/me/ds-2026"]').click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __copied?: string }).__copied)).toBe("https://maccount.example.test/me/ds-2026");
  await expect(page.locator('[data-copy-path="/me/ds-2026"]')).toHaveText("已複製");
});

test("destructive admin actions use an accessible confirmation dialog", async ({ page }) => {
  let posts = 0;
  await page.route("https://maccount.example.test/**", async (route) => {
    if (route.request().method() === "POST") posts++;
    await route.fulfill({ contentType: "text/html", body: adminFixture() });
  });
  await page.goto("https://maccount.example.test/admin");

  const deleteButton = page.locator('form[action$="/delete"] button').first();
  await deleteButton.click();
  const dialog = page.locator("[data-confirm-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-labelledby", "confirm-dialog-title");
  await expect(dialog.locator("#confirm-dialog-title")).toHaveText("刪除帳號綁定？");
  await expect(dialog.locator("#confirm-dialog-message")).toContainText("所有課程都會受影響");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
  expect(posts).toBe(0);

  await deleteButton.click();
  await dialog.locator("[data-confirm-cancel]").click();
  await expect(dialog).toBeHidden();
  expect(posts).toBe(0);

  await page.locator('textarea[name="student_ids"]').fill("a01");
  await page.locator('input[name="replace"]').check();
  await page.locator('form[action$="/enroll"] button[type="submit"]').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#confirm-dialog-title")).toHaveText("覆蓋整份選課名單？");
  await expect(dialog.locator("#confirm-dialog-message")).toContainText("未列出的學生會從本課移除");
  await dialog.locator("[data-confirm-cancel]").click();
  expect(posts).toBe(0);

  await deleteButton.click();
  await dialog.locator("[data-confirm-submit]").click();
  await expect.poll(() => posts).toBe(1);
});

test("help hints open on click and close with Escape", async ({ page }) => {
  await page.setContent(adminFixture(), { waitUntil: "load" });
  const hint = page.locator("#bindings [data-help-hint]").first();
  const button = hint.locator("[data-help-toggle]");
  const panel = hint.locator("[data-help-panel]");

  await expect(panel).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("綁定名單是學生全域帳號對應");

  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

test("student and admin pages have no automated WCAG A/AA violations", async ({ page }) => {
  const student = dashboardPage(
    "zh",
    { id: "a01", name: "Alice" },
    bindings[1],
    [grade],
    false,
    {},
    [],
    { "ds-2026": "資料結構 2026" },
    [{ course_id: "ds-2026", name: "資料結構 2026" }],
  );

  for (const html of [student, adminFixture()]) {
    await page.setContent(html, { waitUntil: "load" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});

test("student course card exposes a grade summary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(dashboardPage(
    "en", { id: "a01", name: "Alice" }, bindings[1], [grade], false, {},
    [], { "ds-2026": "Data Structures 2026" },
  ));
  const summary = page.locator('.course-summary[aria-label="Course grade summary"]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("1 / 1");
  await expect(summary.locator('progress[aria-label="Total score 100 / 100"]')).toHaveAttribute("value", "100");
  const columns = await summary.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);
  await expect(page.locator(".mobile-card-table td").first()).toHaveCSS("display", "grid");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("admin tables hide secondary columns on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(adminFixture(), { waitUntil: "load" });
  const table = page.locator("#course-bindings-table");
  await expect(table.locator("th").filter({ hasText: "GitHub id" })).toBeHidden();
  await expect(table.locator("th").filter({ hasText: "NYCU id" })).toBeVisible();
  await expect(table.locator("tbody tr[data-row]").first()).toContainText("z99");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("admin course cards collapse to one column on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(adminHomePage("zh", [course, { ...course, course_id: "old", status: "archived" }], { isOwner: true }));
  const columns = await page.locator(".course-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
