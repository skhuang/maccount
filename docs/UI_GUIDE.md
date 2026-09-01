# maccount UI guide

This document is the shared contract for the static landing page and the
Worker-rendered UI. Both surfaces intentionally remain dependency-free, so the
tokens are duplicated in `ui.css` and `UI_CSS` in `src/html.ts`; changes to a
shared token must update both locations in the same pull request.

## Canonical tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f4f7f6` | page background |
| `--surface` | `#fff` | primary surface |
| `--surface-soft` | `#f8faf9` | secondary surface |
| `--text` | `#17211d` | primary text |
| `--muted` | `#5f6f67` | supporting text |
| `--line` | `#dbe4df` | borders and dividers |
| `--brand` | `#087f5b` | primary actions and links |
| `--brand-hover` | `#066b4c` | hover state |
| `--danger` | `#c92a2a` | destructive/error state |
| `--radius` | `12px` | cards and page surfaces |
| `--shadow` | `0 12px 32px rgba(20,45,34,.08)` | desktop page surface |

Controls must have a minimum 42px target (44px on the public landing page), a
visible keyboard focus ring, and a text label. At widths up to 640px, content
must not cause horizontal page overflow. Data hidden from compact tables must
remain available through an expandable “full details” control.

## Visual and role checks

The Playwright UI suite covers the public landing page, student dashboard, and
owner administration view at desktop and 390px mobile widths. It verifies
computed layout, responsive visibility, bilingual copy, interaction states,
and automated WCAG A/AA rules. These stable assertions are preferred to pixel
snapshots because CI and local systems use different font renderers.

Before a release that materially changes navigation, manually complete these
three smoke journeys in a staging environment:

1. New student: NYCU sign-in → bind GitHub and Google → open a course task.
2. Returning student: alternate sign-in → find the nearest exam deadline.
3. Course owner: find an unbound student → export roster → open an external
   service → open course settings.

## Privacy-preserving product observation

Do not install third-party analytics or emit student IDs, names, emails, OAuth
identifiers, course IDs, repository names, or URLs. If operational metrics are
later enabled, use Cloudflare's aggregate observability with a fixed allowlist
of event names and coarse outcomes only:

- `auth_start`: provider (`nycu`, `github`, `google`)
- `auth_result`: provider and outcome (`success`, `not_bound`, `error`)
- `admin_action`: action family (`export`, `drive`, `forms`, `classroom`) and
  outcome (`success`, `partial`, `error`)

Do not add a client beacon endpoint solely for UI analytics. Document retention
and update the privacy notice before enabling durable event storage.
