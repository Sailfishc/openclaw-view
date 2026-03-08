# Product Context

## Why This Exists

OpenClaw runtime behavior is hard to inspect when debugging agent loops, prompt construction, tool execution, and session lifecycle transitions. This project provides a built-in trace surface so developers can see what happened without attaching a separate debugger.

## User Problem

Users need to answer questions such as:

- What messages entered and left the system?
- What prompt context and tools were assembled before a model call?
- Which model or provider was selected?
- Which tools ran, with what results, and how long did they take?
- When did compaction, reset, stop, bootstrap, or startup events occur?

## Intended Experience

- Traces should start being captured as soon as the plugin loads.
- Log files should be organized per project and resumable across short restarts.
- The API should be simple enough for both the built-in viewer and manual inspection.
- The viewer should make raw event inspection easy first, then add higher-level summaries and conversation-oriented views.

## Product Boundaries

- Local-first and file-backed.
- Read-oriented UI; plugin observes system behavior but does not modify agent execution.
- Data volume is controlled through truncation and log rotation.

## Success Indicators

- Developers can reproduce and inspect a Gateway session through `/trace/api/*` or the browser UI.
- Trace logs remain safe to browse later by project.
- Common lifecycle stages are covered well enough to debug prompt, model, tool, and session behavior.
