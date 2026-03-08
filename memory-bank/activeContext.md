# Active Context

## Date

2026-03-08

## Current Focus

The repository is in the middle of turning the initial trace viewer into a more complete product. The plugin side is ahead of the frontend side: hook coverage, log persistence, HTTP endpoints, and SSE support are present, while the web app is still a minimal raw event browser.

## Important Current Decisions

- Hook registration is split between `api.on(...)` and `api.registerHook(...)` based on how the OpenClaw API actually behaves.
- Message lifecycle plugin hooks use underscore event names for `api.on`, while automation-only hooks such as `message:transcribed` and `message:preprocessed` stay on `registerHook`.
- `tool_result_persist` is kept on `registerHook` because current notes indicate it is synchronous and plugin-specific.
- Logger initialization does not trust Gateway `process.cwd()`. It starts with `config.projectName` or `trace-viewer`, then switches to the real workspace name when `agent:bootstrap` provides `workspaceDir`.
- Logs are separated by project directory under `~/.openclaw/trace-viewer`, use `---` as record separators, resume recent files within one hour, and rotate by size.
- The plugin serves the built frontend from `../../web/dist`, so the web workspace must be built for `/trace` to work correctly.

## Current Implementation Snapshot

- `shared/src/index.ts` defines event types, payloads, stats structures, SSE message shapes, and API response types.
- `plugin/src/index.ts` registers trace hooks, HTTP API routes, SSE, static file serving for `/trace`, and lifecycle service start/stop handlers.
- `plugin/src/trace-logger.ts` owns file-backed logging, stats computation, historical log listing/loading, SSE fan-out, path validation, truncation, and project re-initialization.
- `web/src/App.tsx` loads `/trace/api/events` once on mount and renders a two-pane raw viewer.
- `web/src/components/EventList.tsx` and `web/src/components/DetailPanel.tsx` provide the current list/detail UI only.

## Recent Changes To Remember

- Recent commits corrected hook signatures, project name resolution, plugin manifest copying during build, and added `message:transcribed` coverage.
- The worktree is dirty. Modified files include docs, shared/plugin/web source, and package metadata. Untracked research docs and new frontend files are present. Treat this state as intentional unless a later task proves otherwise.

## Near-Term Next Steps

- Finish the frontend beyond raw mode: stats dashboard, historical log browser, conversation-oriented view, and live SSE updates.
- Keep validating hook behavior against actual OpenClaw docs/runtime because plugin API assumptions have already needed correction.
- Verify end-to-end build and runtime loading after larger frontend changes because the plugin serves compiled assets directly.
