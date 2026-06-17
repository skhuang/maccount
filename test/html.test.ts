import { describe, it, expect } from "vitest";
import { adminPage } from "../src/html";
import type { BindingRow } from "../src/csv";

const rows: BindingRow[] = [
  {
    nycu_id: "0856001",
    nycu_name: "<script>x</script>",
    github_id: 42,
    github_login: "octo",
    created_at: "2026-06-16T00:00:00.000Z",
    updated_at: "2026-06-16T00:00:00.000Z",
  },
];

describe("adminPage", () => {
  it("shows the count and an export link", () => {
    const html = adminPage("zh", rows);
    expect(html).toContain("(1)");
    expect(html).toContain('href="/admin/export.csv"');
  });

  it("escapes HTML in user-controlled fields", () => {
    const html = adminPage("zh", rows);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("renders a delete form per row", () => {
    const html = adminPage("zh", rows);
    expect(html).toContain('action="/admin/delete"');
    expect(html).toContain('name="nycu_id" value="0856001"');
  });

  it("does not interpolate user data into the inline onsubmit JS", () => {
    const html = adminPage("zh", [{ ...rows[0], nycu_id: "O'Brien" }]);
    // The id must not appear inside the confirm() JS string literal (would be
    // a DOM-XSS vector once the HTML parser decodes the entity back to a quote).
    expect(html).not.toContain("confirm('刪除");
    expect(html).toContain("confirm('確定刪除此綁定？')");
    // It still appears, safely escaped, in the hidden input attribute.
    expect(html).toContain('value="O&#39;Brien"');
  });
});
