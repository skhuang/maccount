import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  bulkEnroll, replaceEnrollments, enrollmentCount, listEnrolledWithBinding,
  removeEnrollment, coursesForStudent, studentIdsForMoodleEmail,
} from "../src/db/enrollments";

const C = "ds-2026";
const now = "2026-06-18T00:00:00.000Z";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM enrollments").run();
  await env.DB.prepare("DELETE FROM bindings").run();
});

describe("enrollments db", () => {
  it("bulkEnroll dedupes and is idempotent", async () => {
    expect(await bulkEnroll(env.DB, C, ["a", "b", "a", " ", "c"], now)).toBe(3);
    await bulkEnroll(env.DB, C, ["a", "d"], now); // re-add a, add d
    expect(await enrollmentCount(env.DB, C)).toBe(4);
  });

  it("replaceEnrollments swaps the whole roster", async () => {
    await bulkEnroll(env.DB, C, ["a", "b", "c"], now);
    expect(await replaceEnrollments(env.DB, C, ["c", "d"], now)).toBe(2);
    const ids = (await listEnrolledWithBinding(env.DB, C)).map((e) => e.student_id);
    expect(ids).toEqual(["c", "d"]);
  });

  it("stores Moodle name and email on enrollment rows", async () => {
    await replaceEnrollments(env.DB, C, [
      { student_id: "a", name: "王小明", email: "a@nycu.edu.tw" },
      { student_id: "b", name: "", email: "" },
    ], now);
    const rows = await listEnrolledWithBinding(env.DB, C);
    expect(rows).toMatchObject([
      { student_id: "a", name: "王小明", email: "a@nycu.edu.tw" },
      { student_id: "b", name: null, email: null },
    ]);
    await bulkEnroll(env.DB, C, [{ student_id: "b", name: "李小華", email: "b@nycu.edu.tw" }], now);
    const b = (await listEnrolledWithBinding(env.DB, C)).find((r) => r.student_id === "b");
    expect(b).toMatchObject({ name: "李小華", email: "b@nycu.edu.tw" });
  });

  it("replace is scoped to the course (does not touch other courses)", async () => {
    await bulkEnroll(env.DB, "ds-2026", ["a"], now);
    await bulkEnroll(env.DB, "ds-2027", ["x"], now);
    await replaceEnrollments(env.DB, "ds-2026", ["b"], now);
    expect(await enrollmentCount(env.DB, "ds-2027")).toBe(1);
  });

  it("listEnrolledWithBinding shows bound vs unbound (github + google)", async () => {
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, google_email, created_at, updated_at) VALUES ('a','甲',1,'alice','alice@gmail.com','t','t')",
    ).run();
    await bulkEnroll(env.DB, C, ["a", "b"], now);
    const rows = await listEnrolledWithBinding(env.DB, C);
    expect(rows).toEqual([
      { student_id: "a", name: null, email: null, nycu_name: "甲", github_login: "alice", github_id: 1, google_email: "alice@gmail.com" },
      { student_id: "b", name: null, email: null, nycu_name: null, github_login: null, github_id: null, google_email: null },
    ]);
  });

  it("removeEnrollment + coursesForStudent", async () => {
    await bulkEnroll(env.DB, "ds-2026", ["a"], now);
    await bulkEnroll(env.DB, "ds-2027", ["a"], now);
    expect(await coursesForStudent(env.DB, "a")).toEqual(["ds-2026", "ds-2027"]);
    await removeEnrollment(env.DB, "ds-2026", "a");
    expect(await coursesForStudent(env.DB, "a")).toEqual(["ds-2027"]);
  });

  it("studentIdsForMoodleEmail matches email case-insensitively and dedupes across courses", async () => {
    await replaceEnrollments(env.DB, "ds-2026", [{ student_id: "a", email: "A@Gmail.com" }], now);
    await replaceEnrollments(env.DB, "ds-2027", [{ student_id: "a", email: "a@gmail.com" }], now);
    await replaceEnrollments(env.DB, "ds-2028", [{ student_id: "b", email: "a@gmail.com" }], now);
    expect(await studentIdsForMoodleEmail(env.DB, "a@gmail.com")).toEqual(["a", "b"]);
  });
});
