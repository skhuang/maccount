import { describe, it, expect } from "vitest";
import {
  adminPage,
  adminHomePage,
  bindingsPage,
  coursePrejoinPage,
  dashboardPage,
  orgMembersPage,
} from "../src/html";
import type { BindingRow } from "../src/csv";
import type { GradeRow } from "../src/db/grades";

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
  it("includes the shared responsive UI foundation", () => {
    const html = adminPage("zh", course, rows);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("--brand:#087f5b");
    expect(html).toContain("overflow-x:auto");
  });

  it("shows the count and a course-scoped export link", () => {
    const html = adminPage("zh", course, rows);
    expect(html).toContain("(1)");
    expect(html).toContain('href="/c/ds-2026/admin/export.csv"');
    expect(html).toContain("資料結構 2026");
  });

  it("groups admin tools into navigable sections with summary stats", () => {
    const html = adminPage("zh", course, rows, {
      isOwner: true,
      staff: [],
      enrolled: [{ student_id: "0856001", github_login: "octo", google_email: null }],
    });
    expect(html).toContain('class="section-nav"');
    expect(html).toContain('href="#bindings"');
    expect(html).toContain('id="enrollment"');
    expect(html).toContain('id="settings"');
    expect(html).toContain('class="stats-grid"');
  });

  it("adds searchable binding and filterable enrollment tables", () => {
    const html = adminPage("zh", course, rows, {
      isOwner: true,
      staff: [],
      enrolled: [
        { student_id: "a01", github_login: "alice", google_email: "a@example.com" },
        { student_id: "b02", github_login: null, google_email: null },
      ],
    });
    expect(html).toContain('data-table-id="course-bindings-table"');
    expect(html).toContain('data-table-id="enrollment-table"');
    expect(html).toContain('data-status="complete"');
    expect(html).toContain('data-status="missing"');
    expect(html).toContain(`<option value="missing">未完整綁定</option>`);
    expect(html).toContain("data-table-search");
    expect(html).toContain('id="course-bindings-table" class="mobile-compact"');
    expect(html).toContain('class="mobile-secondary" data-sort-column="3"');
  });

  it("provides a copy action for the prospective-student link", () => {
    const html = adminPage("en", course, [], { isOwner: true, staff: [] });
    expect(html).toContain('data-copy-path="/me/ds-2026"');
    expect(html).toContain(">Copy link</button>");
    expect(html).toContain("navigator.clipboard.writeText");
  });

  it("gives admin form controls persistent labels and marks risky replacement", () => {
    const html = adminPage("zh", course, [], { isOwner: true, staff: [] });
    expect(html).toContain(`<label>學生學號<textarea name="student_ids"`);
    expect(html).toContain(`<label>Drive 檔案或資料夾<input name="file_id"`);
    expect(html).toContain(`<label>分享權限<select name="role"`);
    expect(html).toContain(`<label>問卷標題<input name="title"`);
    expect(html).toContain('class="check-row check-row--danger"');
    expect(html).toContain('data-confirm-when="replace"');
    expect(html).toContain("未列出的學生會從本課移除");
  });

  it("renders an explicit empty state when there are no bindings", () => {
    const html = adminPage("en", course, [], { isOwner: false, staff: [] });
    expect(html).toContain('class="empty-cell">No account bindings yet.</td>');
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
      { ...course, term: "2026", moodle_course_id: "12345", google_classroom_id: "CR-789", status: "archived" },
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
    expect(html).toContain('name="google_classroom_id" value="CR-789"');
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

  it("shows the Google Forms section with attached forms, add + create forms", () => {
    const html = adminPage("zh", course, [], {
      isOwner: true,
      staff: [],
      forms: [{ id: 1, title: "意見調查", url: "https://docs.google.com/forms/d/abc/viewform" }],
    });
    expect(html).toContain("Google 問卷");
    expect(html).toContain("意見調查");
    expect(html).toContain('href="https://docs.google.com/forms/d/abc/viewform"');
    expect(html).toContain('action="/c/ds-2026/admin/forms/add"');    // paste a link
    expect(html).toContain('action="/c/ds-2026/admin/forms/create"'); // create via API
  });

  it("shows an edit link for an API-created form (has form_id)", () => {
    const html = adminPage("zh", course, [], {
      isOwner: true,
      staff: [],
      forms: [{ id: 2, title: "小考", url: "https://docs.google.com/forms/d/e/F9/viewform", form_id: "F9" }],
    });
    expect(html).toContain('href="https://docs.google.com/forms/d/F9/edit"');
  });

  it("shows the Classroom invite form when a classroom id is set, else a notice", () => {
    const withId = adminPage("zh", { ...course, google_classroom_id: "CR-789" }, [], { isOwner: true, staff: [] });
    expect(withId).toContain("Google Classroom");
    expect(withId).toContain("CR-789");
    expect(withId).toContain('action="/c/ds-2026/admin/classroom/invite"');
    const noId = adminPage("zh", course, [], { isOwner: true, staff: [] });
    expect(noId).not.toContain('action="/c/ds-2026/admin/classroom/invite"');
    expect(noId).toContain("尚未設定 Google Classroom ID");
  });

  it("forms section has the pre-enroll checkbox, prospective entry link + badge", () => {
    const html = adminPage("zh", course, [], {
      isOwner: true,
      staff: [],
      forms: [{ id: 1, title: "報到問卷", url: "https://forms.gle/pre", pre_enroll: 1 }],
    });
    expect(html).toContain('name="pre_enroll"');     // checkbox on the add/create forms
    expect(html).toContain("/me/ds-2026");            // prospective-student entry link
    expect(html).toContain("（尚未選課）");            // badge on the pre-enroll form
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

  it("escapes user data in accessible confirmation details without inline confirm JS", () => {
    const html = adminPage("zh", course, [{ ...rows[0], nycu_id: "O'Brien" }], { isOwner: true, staff: [] });
    expect(html).not.toContain("confirm(");
    expect(html).toContain('data-confirm-title="刪除帳號綁定？"');
    expect(html).toContain("將刪除 O&#39;Brien 的全域 GitHub／Google 帳號綁定");
    expect(html).toContain('class="confirm-dialog"');
    expect(html).toContain('value="O&#39;Brien"');
  });
});

describe("admin list tools", () => {
  it("adds client-side search to the global bindings list", () => {
    const html = bindingsPage("en", rows);
    expect(html).toContain('data-table-id="bindings-table"');
    expect(html).toContain('<table id="bindings-table"');
    expect(html).toContain("Showing {visible} of {total}");
    expect(html).toContain('data-sort-column="0"');
    expect(html).toContain('header.setAttribute("aria-sort",ascending?"ascending":"descending")');
    expect(html).toContain("No rows match the current filters.");
  });

  it("adds membership status filters to the org list", () => {
    const html = orgMembersPage("zh", "example-org", {
      rows: [{ student_id: "a01", nycu_name: "甲", github_login: "alice", status: "pending" }],
      unbound: [],
    });
    expect(html).toContain('data-table-id="org-members-table"');
    expect(html).toContain('<option value="pending">待接受</option>');
    expect(html).toContain('data-status="pending"');
  });
});

describe("dashboardPage", () => {
  const grade: GradeRow = {
    course_id: "ds-2026",
    student_id: "0856001",
    problem_id: "lab01-stack",
    verdict: "AC",
    score: 100,
    max_score: 100,
    updated_at: "2026-06-24T00:00:00Z",
    repo: "octo/lab01-stack",
    assignment_id: "lab01",
    assignment_type: "lab",
    assignment_title: "Lab 1",
  };

  it("renders account status cards, course cards, and accessible verdict badges", () => {
    const html = dashboardPage(
      "zh",
      { id: "0856001", name: "學生" },
      { ...rows[0], google_email: "octo@gmail.com" },
      [grade],
      false,
      {},
      [],
      { "ds-2026": "資料結構 2026" },
      [{ course_id: "ds-2026", name: "資料結構 2026" }],
    );
    expect(html).toContain('class="account-grid"');
    expect(html).toContain('class="course-card"');
    expect(html).toContain('class="mobile-card-table"');
    expect(html).toContain('data-label="題目"');
    expect(html).toContain('class="badge badge--success">AC</span>');
    expect(html).toContain("octo@gmail.com");
  });

  it("summarizes graded work, accepted results, score, and latest update", () => {
    const html = dashboardPage(
      "zh", { id: "0856001", name: "學生" }, null,
      [
        grade,
        { ...grade, problem_id: "lab02", verdict: "WA", score: 30, max_score: 50, updated_at: "2026-06-24T02:00:00Z" },
        { ...grade, problem_id: "lab03", verdict: null, score: null, max_score: 50, updated_at: "2026-06-24T01:00:00Z" },
      ],
      false, {},
    );
    expect(html).toContain('class="stats-grid course-summary"');
    expect(html).toContain('<span class="stat__value">2 / 3</span>');
    expect(html).toContain('<span class="stat__value">1</span><span class="stat__label">已通過</span>');
    expect(html).toContain('<span class="stat__value">130 / 150</span>');
    expect(html).toContain('aria-label="總分 130 / 150"');
    expect(html).toContain("2026/06/24 10:00");
  });

  it("keeps unknown verdict text escaped and uses a warning badge", () => {
    const html = dashboardPage(
      "en", { id: "0856001", name: "Student" }, null,
      [{ ...grade, verdict: "<pending>" }], false, {},
    );
    expect(html).toContain('class="badge badge--warning">&lt;pending&gt;</span>');
    expect(html).not.toContain("<pending>");
  });
});

describe("coursePrejoinPage", () => {
  it("shows binding actions + the pre-enroll forms", () => {
    const html = coursePrejoinPage(
      "zh", "ds-2026", "資料結構 2026", { id: "S1", name: "生" }, null,
      [{ title: "報到問卷", url: "https://forms.gle/pre" }], {},
    );
    expect(html).toContain("資料結構 2026");
    expect(html).toContain("報到問卷");
    expect(html).toContain('href="https://forms.gle/pre"');
    expect(html).toContain("/auth/github/start");
    expect(html).toContain("/auth/google/start");
    expect(html).toContain("尚未綁定"); // not-bound state for both
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
    expect(html).toContain('class="course-grid"');
    expect(html).toContain("進行中");
    expect(html).toContain("已封存");
    expect(html).toContain('class="course-admin-card course-admin-card--archived"');
    expect(html).toContain("共 2 門課程");
  });

  it("shows the create-course form to owners only", () => {
    const html = adminHomePage("zh", courses, { isOwner: true });
    expect(html).toContain('action="/admin/courses"');
    expect(html).toContain('class="admin-disclosure"');
    expect(html).toContain("新增或更新課程");
    expect(html).toContain(`<label>課程名稱（如 資料結構 2026）<input name="name"`);
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
