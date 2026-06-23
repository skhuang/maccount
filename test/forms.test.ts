import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  listCourseForms, listFormsForCourses, addCourseForm, removeCourseForm,
} from "../src/db/forms";

const now = "2026-06-20T00:00:00.000Z";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM course_forms").run();
});

describe("course_forms db", () => {
  it("adds and lists forms per course", async () => {
    await addCourseForm(env.DB, "ds-2026", "意見調查", "https://docs.google.com/forms/d/a/viewform", now);
    await addCourseForm(env.DB, "ds-2026", "期末回饋", "https://forms.gle/xyz", now);
    const forms = await listCourseForms(env.DB, "ds-2026");
    expect(forms.map((f) => f.title)).toEqual(["意見調查", "期末回饋"]);
    expect(forms[0].url).toBe("https://docs.google.com/forms/d/a/viewform");
  });

  it("listFormsForCourses spans courses; empty input is a no-op", async () => {
    await addCourseForm(env.DB, "ds-2026", "A", "https://forms.gle/a", now);
    await addCourseForm(env.DB, "swtest-2027", "B", "https://forms.gle/b", now);
    const forms = await listFormsForCourses(env.DB, ["ds-2026", "swtest-2027"]);
    expect(forms.map((f) => f.title).sort()).toEqual(["A", "B"]);
    expect(await listFormsForCourses(env.DB, [])).toEqual([]);
  });

  it("removes a form scoped to its course (can't delete via another course id)", async () => {
    await addCourseForm(env.DB, "ds-2026", "A", "https://forms.gle/a", now);
    const [f] = await listCourseForms(env.DB, "ds-2026");
    await removeCourseForm(env.DB, f.id, "swtest-2027"); // wrong course → no-op
    expect(await listCourseForms(env.DB, "ds-2026")).toHaveLength(1);
    await removeCourseForm(env.DB, f.id, "ds-2026"); // correct course → removed
    expect(await listCourseForms(env.DB, "ds-2026")).toHaveLength(0);
  });
});
