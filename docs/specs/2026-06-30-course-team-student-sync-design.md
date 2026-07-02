# Sync enrolled students to their course GitHub team (design)

## Goal

Add **enrolled ∩ GitHub-bound** students to their course's GitHub **team**
(`courses.github_team_slug`), not just the org. Today, binding GitHub
auto-invites a student to the course **org** (`githubCallback` →
`studentOrgs` → `inviteOrgMember`), but nothing adds them to the course's
student **team**. This closes that gap with two triggers, mirroring the
existing **staff → `STAFF_TEAM`** sync (`syncStaffToGitHub`).

The team already has repo (`write`) access, so once a student is in the team
they get developer access to the course repo automatically.

## Decisions (settled in brainstorming)

- **Home: maccount** (not dsjudge). maccount is the authority for courses,
  enrollments, GitHub bindings, and org/team mapping, and already owns the
  GitHub OAuth token and the org-invite + staff-team-sync machinery. Building in
  dsjudge would duplicate all of this and need a second org-admin token.
- **Both triggers:**
  1. **On GitHub bind** — add the student to their enrolled courses' teams
     (parallel to the existing org auto-invite).
  2. **Manual per-course batch** — a "Sync students to team" button in
     `/c/{course}/admin` that back-fills all enrolled∩bound students (parallel
     to the staff-sync button).
- **Multi-course** falls out for free: on bind a student is synced to *all*
  their enrolled courses' teams; the batch button is per course.
- **Add-only** for students (no auto-remove) — matches the org-invite behavior
  (drops are handled elsewhere / out of scope here).

## Reused, already-present pieces

- `src/oauth/github.ts`: `inviteOrgMember(org, login, token)`,
  `addTeamMembership(org, team, login, token)` (already used by the staff sync).
- `src/db/courses.ts`: `courses` rows carry `github_org` + `github_team_slug`;
  `listCourses`, `getCourse`, `effectiveOrg(env, course)`.
- `src/db/enrollments.ts`: `listEnrolledWithBinding(db, course_id) → EnrolledStudent[]`
  (enrolled ∩ bound), `coursesForStudent`.
- `src/index.ts`: `studentOrgs(env, studentId)`, `syncStaffToGitHub` (the pattern
  to mirror), `/c/{course}/admin` course-scoped routes + `adminRedirect` flash.
- `env.ORG_INVITE_TOKEN` — already has org **members + team** write scope (the
  staff sync uses it for `addTeamMembership`). **No new token needed.**

## Components

### 1. `studentTeams(env, studentId): Promise<{org, team}[]>` (src/index.ts)

Parallel to `studentOrgs`. For each course the student is enrolled in
(`coursesForStudent` ∩ `listCourses`), if the course has both an effective org
and a non-empty `github_team_slug`, include `{org: effectiveOrg(env,c), team: c.github_team_slug}`.
Deduped. Returns `[]` when no enrolled course defines a student team.

### 2. Trigger A — on GitHub bind (`githubCallback`)

After the existing org-invite loop, add a best-effort team loop:

```ts
if (env.ORG_INVITE_TOKEN) {
  for (const { org, team } of await studentTeams(env, session.nycu.id)) {
    try {
      await addTeamMembership(org, team, gh.login, env.ORG_INVITE_TOKEN);
      console.log(`team add: ${gh.login} -> ${org}/${team}`);
    } catch (e) {
      console.error(`team add failed (${org}/${team}):`, (e as Error).message);
    }
  }
}
```

- Runs **after** the org-invite loop (org membership is the prerequisite;
  `addTeamMembership` on a not-yet-accepted member creates a pending team invite,
  which resolves when they accept the org invite — acceptable).
- **Best-effort**: a failure must never affect the binding (same rule as the
  org-invite loop).

### 3. Trigger B — batch `syncStudentsToTeam(env, courseId)` (src/index.ts)

Mirror `syncStaffToGitHub`, batched over the course's students:

```
course = getCourse(courseId)
if not (course.github_org resolvable) or not course.github_team_slug or not ORG_INVITE_TOKEN:
    return { skipped: "not-configured" }
students = listEnrolledWithBinding(db, courseId)      # enrolled ∩ bound
for s in students:
    try:
        inviteOrgMember(org, s.github_login, tok)     # ensure org (idempotent)
        addTeamMembership(org, team, s.github_login, tok)
        added++
    except: failed++ (log, keep going)
return { total, added, failed }
```

Idempotent (adding an existing member is a no-op). Per-student isolation so one
failure doesn't abort the batch.

### 4. Route + UI (per-course admin)

- **Route:** `POST /c/{course}/admin/sync-students-team` →
  `syncStudentsToTeam(env, course)` → `adminRedirect(course, "students_team:<summary>")`
  (flash, same style as the staff-sync `staff_msg`). Admin-gated exactly like
  the existing `/c/{course}/admin` staff actions.
- **UI:** on the per-course admin page, next to the staff-team controls, a
  **"Sync students to team"** button showing the enrolled∩bound count and,
  after posting, a flash like `added N, failed M` (or `not configured` when the
  course has no `github_team_slug`). Disabled/hidden when `github_team_slug` is
  unset. i18n strings added alongside the existing staff-sync labels.

## Data flow

```
bind GitHub ─► githubCallback ─► studentOrgs → inviteOrgMember (org, existing)
                              └► studentTeams → addTeamMembership (team, NEW)

/c/{course}/admin ─"Sync students to team"─► POST sync-students-team
   ─► listEnrolledWithBinding(course) ─► per student: inviteOrgMember + addTeamMembership
   ─► flash: added/failed
```

## Testing (vitest; mirror existing staff-sync tests)

- **`studentTeams`**: enrolled in 2 courses (one with a team, one without) →
  returns only the configured `{org, team}`; not enrolled / no team → `[]`.
- **`syncStudentsToTeam`**: mock GitHub client — N enrolled∩bound → N
  `addTeamMembership` calls; a course with no `github_team_slug` → `skipped`;
  a GitHub failure on one student → counted `failed`, others still processed.
- **`githubCallback`**: with a course team configured, binding triggers
  `addTeamMembership` for the student's team(s); a team-add failure does **not**
  fail the binding.
- **Route/admin**: `POST /c/{course}/admin/sync-students-team` is admin-gated and
  redirects with the summary flash. (Playwright button-renders-and-posts is
  optional, matching current admin test coverage.)

## Scope / YAGNI

- **In:** `studentTeams`, the on-bind team loop, `syncStudentsToTeam` batch,
  the admin route + button + i18n, tests.
- **Out:** removing students from teams on un-enroll (no student auto-remove;
  matches org-invite); any dsjudge change (its `invite_org` org backfill is
  unaffected and still valid); new tokens or new courses schema (org/team already
  on `courses`); Google Classroom/Group changes.

## Success criteria

1. Binding GitHub adds the student to every enrolled course's `github_team_slug`
   (best-effort; binding never fails on a team error).
2. `/c/{course}/admin` has a working "Sync students to team" button that
   back-fills enrolled∩bound students and reports `added/failed`.
3. Both paths are idempotent and reuse `ORG_INVITE_TOKEN` (no new secret).
4. Tests cover `studentTeams`, the batch sync, and the on-bind path.
