import { describe, it, expect } from "vitest";
import { adminPage, adminHomePage } from "../src/html";
import type { BindingRow } from "../src/csv";

const course = { course_id: "ds-2026", name: "資料結構 2026" };

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
  it("shows the count and a course-scoped export link", () => {
    const html = adminPage("zh", course, rows);
    expect(html).toContain("(1)");
    expect(html).toContain('href="/c/ds-2026/admin/export.csv"');
    expect(html).toContain("資料結構 2026");
  });

  it("shows the Google column with the bound email", () => {
    const html = adminPage("zh", course, [{ ...rows[0], google_email: "octo@gmail.com" }]);
    expect(html).toContain("<th>Google</th>");
    expect(html).toContain("octo@gmail.com");
  });

  it("escapes HTML in user-controlled fields", () => {
    const html = adminPage("zh", course, rows);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("renders a course-scoped delete form per row (owner only)", () => {
    const html = adminPage("zh", course, rows, { isOwner: true, staff: [] });
    expect(html).toContain('action="/c/ds-2026/admin/delete"');
    expect(html).toContain('name="nycu_id" value="0856001"');
  });

  it("hides delete forms for non-owner staff", () => {
    const html = adminPage("zh", course, rows, { isOwner: false, staff: [] });
    expect(html).not.toContain("/admin/delete");
  });

  it("owner sees the staff-management section (course-scoped); staff does not", () => {
    expect(adminPage("zh", course, rows, { isOwner: true, staff: [] })).toContain(
      'action="/c/ds-2026/admin/staff/add"',
    );
    expect(adminPage("zh", course, rows, { isOwner: false, staff: [] })).not.toContain("/admin/staff/");
  });

  it("renders the enrollment section (bound/unbound) and a prefilled settings form for owners", () => {
    const html = adminPage(
      "zh",
      { ...course, term: "2026", moodle_course_id: "12345", status: "archived" },
      [],
      {
        isOwner: true,
        staff: [],
        enrolled: [
          { student_id: "a01", github_login: "alice" },
          { student_id: "b02", github_login: null },
        ],
      },
    );
    expect(html).toContain("選課名單（2）");
    expect(html).toContain("alice");
    expect(html).toContain("未綁定"); // b02 has no binding
    expect(html).toContain(`action="/c/ds-2026/admin/enroll"`);
    // settings form prefilled
    expect(html).toContain('name="moodle_course_id" value="12345"');
    expect(html).toContain('<option value="archived" selected>');
  });

  it("enrollment roster shows Google bound/unbound per student", () => {
    const html = adminPage("zh", course, [], {
      isOwner: true,
      staff: [],
      enrolled: [
        { student_id: "a01", github_login: "alice", google_email: "a01@gmail.com" },
        { student_id: "b02", github_login: null, google_email: null },
      ],
    });
    expect(html).toContain("<th>Google</th>");
    expect(html).toContain("a01@gmail.com"); // a01's bound Google
    expect(html).toContain("未綁定"); // b02 unbound (github + google)
  });

  it("shows the Google Forms section with attached forms + add form", () => {
    const html = adminPage("zh", course, [], {
      isOwner: true,
      staff: [],
      forms: [{ id: 1, title: "意見調查", url: "https://docs.google.com/forms/d/abc/viewform" }],
    });
    expect(html).toContain("Google 問卷");
    expect(html).toContain("意見調查");
    expect(html).toContain('href="https://docs.google.com/forms/d/abc/viewform"');
    expect(html).toContain('action="/c/ds-2026/admin/forms/add"');
  });

  it("hides import + settings from non-owner staff", () => {
    const html = adminPage("zh", course, [], {
      isOwner: false,
      staff: [],
      enrolled: [{ student_id: "a01", github_login: "alice" }],
    });
    expect(html).toContain("選課名單（1）"); // staff can see the roster
    expect(html).not.toContain("/admin/enroll"); // but not import
    expect(html).not.toContain("課程設定"); // nor edit settings
  });

  it("does not interpolate user data into the inline onsubmit JS", () => {
    const html = adminPage("zh", course, [{ ...rows[0], nycu_id: "O'Brien" }], { isOwner: true, staff: [] });
    expect(html).not.toContain("confirm('刪除");
    expect(html).toContain("confirm('確定刪除此綁定？')");
    expect(html).toContain('value="O&#39;Brien"');
  });
});

describe("adminHomePage (course picker)", () => {
  const courses = [
    { course_id: "ds-2026", name: "資料結構 2026", term: "2026", status: "active" },
    { course_id: "swtest-2027", name: "軟體測試 2027", term: "2027", status: "archived" },
  ];

  it("lists each course linking to its course-scoped admin", () => {
    const html = adminHomePage("zh", courses, { isOwner: true });
    expect(html).toContain('href="/c/ds-2026/admin"');
    expect(html).toContain('href="/c/swtest-2027/admin"');
    expect(html).toContain("資料結構 2026");
  });

  it("shows the create-course form to owners only", () => {
    expect(adminHomePage("zh", courses, { isOwner: true })).toContain('action="/admin/courses"');
    expect(adminHomePage("zh", courses, { isOwner: false })).not.toContain('action="/admin/courses"');
  });

  it("escapes course names", () => {
    const html = adminHomePage("zh", [{ course_id: "x", name: "<b>x</b>", term: null, status: "active" }], {
      isOwner: false,
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
