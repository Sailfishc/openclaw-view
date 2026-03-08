# Progress

## What Works

- Monorepo workspace layout for `shared`, `plugin`, and `web`.
- Shared trace event schema covering message, prompt, model, tool, session, command, bootstrap, and startup events.
- File-backed logging with truncation, sequence numbering, recent-log resume, size-based rotation, and per-project isolation.
- HTTP API endpoints for full events, incremental events, stats, log listing, log loading, and SSE.
- Basic React viewer that fetches current events and shows list/detail inspection.
- Security check for historical log loading that rejects symlinks and validates paths remain inside the configured log directory.

## Incomplete

- Frontend stats dashboard.
- Frontend log file browser UX.
- Conversation-mode trace visualization.
- Frontend SSE subscription and live updates.
- Broader runtime verification against real OpenClaw installs.

## Known Risks

- OpenClaw hook APIs appear subtle; wrong assumptions about `api.on` versus `registerHook` can silently drop events.
- The plugin depends on `web/dist` existing at runtime; a missing frontend build will break `/trace`.
- Stats are derived from persisted events and currently emphasize `tool_result:persist`; if hook behavior changes, derived metrics may undercount or skew.
- The simplified plugin SDK typings in `plugin/src/types.ts` are local approximations, not imported from an official package.

## Decision History

- Started as a plugin-first implementation with a minimal UI.
- Added docs and architecture notes after the initial scaffold.
- Follow-up fixes focused on hook correctness, manifest copying, project naming, and extra message hook coverage.

## Suggested Update Rule

When significant work lands, update this file together with `activeContext.md` so the memory bank continues to reflect both shipped capability and the current engineering direction.
