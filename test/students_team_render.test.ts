import { describe, it, expect } from "vitest";
import { adminPage } from "../src/html";

const baseCourse = { course_id: "ds-2026", name: "DS", term: null, moodle_course_id: null, github_org: "org", github_repos: null, google_classroom_id: null } as any;
const opts = { isOwner: true, staff: [], boundCount: 3, enrolled: [], forms: [] } as any;

describe("adminPage students-team section", () => {
  it("renders the button + inline script when github_team_slug is set", () => {
    const html = adminPage("en", { ...baseCourse, github_team_slug: "ds2026-students" }, [], opts);
    expect(html).toContain('id="sync-students-team"');
    expect(html).toContain("<script");
    expect(html).toContain("/students/team/sync");
  });
  it("renders nothing for the section when there is no team", () => {
    const html = adminPage("en", { ...baseCourse, github_team_slug: null }, [], opts);
    expect(html).not.toContain('id="sync-students-team"');
  });
});
