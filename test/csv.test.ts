import { describe, it, expect } from "vitest";
import { toCsv, toGithubAccessCsv, type BindingRow } from "../src/csv";

const row: BindingRow = {
  nycu_id: "0856001",
  nycu_name: "王小明",
  github_id: 12345,
  github_login: "xiaoming",
  created_at: "2026-06-16T00:00:00.000Z",
  updated_at: "2026-06-16T00:00:00.000Z",
};

describe("toCsv", () => {
  it("emits header + row", () => {
    const csv = toCsv([row]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("nycu_id,nycu_name,github_id,github_login,google_email,created_at,updated_at");
    expect(lines[1]).toBe("0856001,王小明,12345,xiaoming,,2026-06-16T00:00:00.000Z,2026-06-16T00:00:00.000Z");
  });

  it("includes a bound google email", () => {
    const csv = toCsv([{ ...row, google_email: "ming@gmail.com" }]);
    expect(csv).toContain("xiaoming,ming@gmail.com,");
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = toCsv([{ ...row, nycu_name: 'a,"b"\nc' }]);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it("renders null fields as empty", () => {
    const csv = toCsv([{ ...row, nycu_name: null, github_login: null }]);
    const cells = csv.trimEnd().split("\n")[1].split(",");
    expect(cells[1]).toBe("");
  });
});

describe("toGithubAccessCsv", () => {
  it("emits course-scoped GitHub access rows for private repo provisioning", () => {
    const csv = toGithubAccessCsv([
      {
        course_id: "ds-2026",
        course_name: "Data Structures, 2026",
        student_id: "0856001",
        name: "王小明",
        github_login: "xiaoming",
        github_org: "nycu-cs-course-ds",
        github_team_slug: "ds2026-students",
        github_repo: "ds2026",
        permission: "write",
      },
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("course_id,course_name,student_id,name,github_login,github_org,github_team_slug,github_repo,permission");
    expect(lines[1]).toBe('ds-2026,"Data Structures, 2026",0856001,王小明,xiaoming,nycu-cs-course-ds,ds2026-students,ds2026,write');
  });
});
