import { describe, it, expect } from "vitest";
import { pickLang, langCookie, langToggle, T } from "../src/i18n";

const u = (qs: string) => new URL(`https://x/me${qs}`);

describe("pickLang", () => {
  it("defaults to zh", () => {
    expect(pickLang(u(""), null)).toBe("zh");
  });
  it("honors ?lang over the cookie", () => {
    expect(pickLang(u("?lang=en"), "lang=zh")).toBe("en");
    expect(pickLang(u("?lang=zh"), "lang=en")).toBe("zh");
  });
  it("falls back to the cookie when no query", () => {
    expect(pickLang(u(""), "foo=1; lang=en")).toBe("en");
  });
  it("ignores an invalid value", () => {
    expect(pickLang(u("?lang=fr"), null)).toBe("zh");
  });
});

describe("langCookie", () => {
  it("sets a long-lived path-/ cookie", () => {
    expect(langCookie("en")).toContain("lang=en");
    expect(langCookie("en")).toContain("Path=/");
  });
});

describe("langToggle", () => {
  it("marks the current language and labels the navigation", () => {
    const html = langToggle("/me", "zh");
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('<span aria-current="true">中文</span>');
    expect(html).toContain('href="/me?lang=en" lang="en"');
  });
});

describe("string tables", () => {
  it("zh and en cover the same keys", () => {
    expect(Object.keys(T.zh).sort()).toEqual(Object.keys(T.en).sort());
  });
});
