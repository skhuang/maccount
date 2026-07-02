# Chunked, progress-reporting student→team sync (design)

*Follow-up to `2026-06-30-course-team-student-sync-design.md`. The batch
"Sync students to team" works, but (a) a single Worker invocation caps at ~50
subrequests, so a ~100-student class overflows, and (b) the plain POST→redirect
gives no feedback while the sync runs — it looks unresponsive and invites
double-clicks.*

## Goal

Make the per-course student→team sync scale to any class size and show live
progress. Split the work into bounded chunks (each invocation stays under the
subrequest cap) and let the browser drive a loop of chunk-requests, updating a
"同步中… X/N" indicator until done. One change solves both the scale limit and
the UX.

## Decisions (settled in brainstorming)

- **Chunked + client-driven progress** (not a Workers plan upgrade). Free-plan
  safe; handles any size; the progress loop inherently provides the "syncing…"
  feedback.
- **Chunk size (`limit`) default 40** — 1 subrequest/student → ≤ 40 per
  invocation, comfortably under the ~50 cap.
- **A small inline `<script>`** on the per-course admin page (there is none
  today) — permitted under the ADMIN_UI_SPEC "server-rendered, no external
  assets" rule (inline, no external asset).
- Add-only; single course; reuse `ORG_INVITE_TOKEN`.

## Background (verified)

Live `wrangler tail` on the current single-shot batch (30 students × 2
subrequests) showed the last ~5 failing with *"Too many subrequests by single
Worker invocation."* A prior fix dropped a redundant `inviteOrgMember` (now 1
subrequest/student), which fixed 30 — but 100 students × 1 = 100 still exceeds
the cap. Chunking removes the ceiling.

## Components

### 1. `syncStudentsToTeam` — chunk window (`src/index.ts`)

Change the signature to an options object (keeps `fetcher` injectable for tests):

```ts
export interface StudentTeamSyncResult {
  total: number;      // full enrolled∩bound count
  processed: number;  // handled in THIS chunk
  added: number;      // succeeded in THIS chunk
  failed: number;     // failed in THIS chunk
  done: boolean;      // offset + processed >= total
  nextOffset: number; // offset + processed
  skipped?: string;   // "not-configured" when org/team/token missing
}

export async function syncStudentsToTeam(
  env: Env, courseId: string,
  opts: { offset?: number; limit?: number; fetcher?: typeof fetch } = {},
): Promise<StudentTeamSyncResult>;
```

- Resolve `org`/`team` as today; if `!org || !team || !env.ORG_INVITE_TOKEN`
  return `{ total: 0, processed: 0, added: 0, failed: 0, done: true, nextOffset: 0, skipped: "not-configured" }`.
- `students = (await listEnrolledWithBinding(env.DB, courseId)).filter(s => s.github_login)`
  — `listEnrolledWithBinding` already `ORDER BY e.student_id`, so slicing is
  stable across chunks.
- `offset = opts.offset ?? 0`, `limit = opts.limit ?? 40`. Iterate
  `students.slice(offset, offset + limit)`; per student `try { await addTeamMembership(org, team, login, token, fetcher); added++ } catch { failed++; console.error(...) }`.
- `processed = the slice length`; `nextOffset = offset + processed`;
  `done = nextOffset >= total`.

### 2. Route — JSON chunk API (`src/index.ts`, `studentsTeamSync`)

Still `requireCourseStaff`-gated first. Read `offset` from the JSON body
(default 0); call `syncStudentsToTeam(env, courseId, { offset, limit: 40 })`;
return the result as JSON:

```ts
async function studentsTeamSync(req, env, courseId) {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  let offset = 0;
  try { offset = Number((await req.json())?.offset) || 0; } catch { offset = 0; }
  const r = await syncStudentsToTeam(env, courseId, { offset, limit: 40 });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
}
```

(Replaces the previous redirect-with-`students_team_msg` flow. The
`students_team_msg` query read in `courseAdmin` and the flash `<p>` become
unused and are removed.)

### 3. UI — button + inline progress script (`src/html.ts`)

Replace the `<form method="POST">` with a button, a status `<span>`, and a small
inline script (rendered only when `github_team_slug` is set, as today):

```html
<button id="sync-students-team" type="button">${t.syncStudentsTeam}</button>
<span class="muted" id="sync-students-status">${boundCount} ${t.enrolledBound}</span>
<script>
(function () {
  var btn = document.getElementById('sync-students-team');
  var out = document.getElementById('sync-students-status');
  var url = '${base}/students/team/sync';
  btn.addEventListener('click', async function () {
    btn.disabled = true;
    var offset = 0, added = 0, failed = 0, total = 0;
    try {
      while (true) {
        var res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offset: offset }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var d = await res.json();
        if (d.skipped) { out.textContent = d.skipped; break; }
        added += d.added; failed += d.failed; total = d.total; offset = d.nextOffset;
        out.textContent = '${t.syncing} ' + offset + '/' + total;
        if (d.done) { out.textContent = '${t.syncDone}: added ' + added + ', failed ' + failed + ' (of ' + total + ')'; break; }
      }
    } catch (e) {
      out.textContent = '${t.syncError}: ' + e.message;
      btn.disabled = false;
    }
  });
})();
</script>
```

- `${base}` is already `encodeURIComponent`-safe. The interpolated values are
  static i18n strings and the safe `base`; the script contains no user data.
- On error the button re-enables so the operator can retry; on success it stays
  disabled (the run finished).

### 4. i18n (`src/i18n.ts`)

Add to both language maps (mirroring the existing keys):
`syncing` ("Syncing…" / "同步中…"), `syncDone` ("Done" / "完成"),
`syncError` ("Sync failed" / "同步失敗"). Keep `syncStudentsTeam`/`enrolledBound`.

## Data flow

```
click ─► [disable btn, "同步中… 0/N"]
        loop: POST {offset} ─► syncStudentsToTeam({offset, limit:40})
              ◄─ JSON { added, failed, total, nextOffset, done }
        update "同步中… nextOffset/total";  until done
        ─► "完成: added X, failed Y (of T)"
```
100 students → 3 chunks (40, 40, 20), each ≤ 40 subrequests.

## Testing (vitest)

- **Chunking**: 3 enrolled∩bound students, `limit: 2` → chunk `offset 0` returns
  `processed 2, done false, nextOffset 2`; chunk `offset 2` returns
  `processed 1, done true, nextOffset 3`. Mock `fetcher` records calls; assert
  ≤ limit team-add calls per chunk.
- **Existing 3 tests** move to the options object (`{ fetcher }`); the
  all-bound test calls with `limit` ≥ total → `processed === total`, `done true`,
  `added === total`; no-team → `skipped: "not-configured"`; one-failing-student
  → `added`/`failed` split within the chunk.
- **Route JSON**: an admin POST returns JSON with the result fields (mirror
  `worker.test.ts`'s admin session); an anonymous POST is still auth-gated
  (302/401/403, no sync).
- The inline JS loop is not unit-tested (no DOM harness); backend + route carry
  the coverage.

## Scope / YAGNI

- **In:** chunk window on `syncStudentsToTeam`, the JSON route, the button +
  inline progress script, i18n strings, tests. Remove the now-unused
  `students_team_msg` flash path.
- **Out:** Queues / Durable Objects / Cron background processing; Workers plan
  upgrade; multi-course batch; auto-remove on un-enroll; changing the on-bind
  path (`syncStudentTeamsOnBind`, already single-call, unaffected).

## Success criteria

1. A 100-student course syncs fully via repeated chunks, each invocation under
   the subrequest cap (no "Too many subrequests").
2. Pressing the button immediately shows "同步中… X/N" progress and a final
   "完成: added N, failed M" summary; the button can't be double-fired mid-run.
3. `npx tsc --noEmit` clean; `npm test` green (chunk + route tests added).
