import { describe, it, expect } from "vitest";
import { accountLoginChooserPage, appLoginChooserPage } from "../../src/ui/app_login";

describe("appLoginChooserPage", () => {
  it("renders three login links carrying lang, escapes appId", () => {
    const html = appLoginChooserPage("en", "dsvisual");
    expect(html).toContain('href="/auth/nycu/start?lang=en"');
    expect(html).toContain('href="/auth/github/login?lang=en"');
    expect(html).toContain('href="/auth/google/login?lang=en"');
    expect(html).toContain("dsvisual");
  });
  it("html-escapes a hostile appId", () => {
    const html = appLoginChooserPage("en", '<script>x</script>');
    expect(html).not.toContain("<script>x</script>");
  });
  it("renders zh labels when lang=zh", () => {
    const html = appLoginChooserPage("zh", "dsvisual");
    expect(html).toContain("用 GitHub 登入");
    expect(html).toContain("用 Google 登入");
  });
});

describe("accountLoginChooserPage", () => {
  it("offers all login methods and forces an NYCU account prompt", () => {
    const html = accountLoginChooserPage("zh");
    expect(html).toContain('href="/auth/nycu/start?prompt=login&amp;lang=zh"');
    expect(html).toContain('href="/auth/github/login?lang=zh"');
    expect(html).toContain('href="/auth/google/login?lang=zh"');
    expect(html).toContain("選擇登入方式");
  });

  it("renders the English chooser and language switch", () => {
    const html = accountLoginChooserPage("en");
    expect(html).toContain("Choose a sign-in method");
    expect(html).toContain('href="/login?lang=zh"');
  });
});
