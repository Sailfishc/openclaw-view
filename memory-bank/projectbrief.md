# Project Brief

## Project

OpenClaw Trace Viewer is a local OpenClaw plugin plus web UI for recording and inspecting agent execution traces in real time. The repository is a TypeScript monorepo with three workspaces:

- `shared`: shared event and API types
- `plugin`: the OpenClaw plugin, hook registration, HTTP API, log persistence, SSE
- `web`: the React viewer served by the plugin

## Goals

- Capture high-value OpenClaw runtime events across message, prompt, model, tool, session, command, and startup lifecycles.
- Persist traces as local project-scoped logs that can be reloaded later.
- Expose trace data through a simple HTTP API and SSE stream.
- Provide a browser UI at `/trace` for inspecting events and, later, higher-level operational views.

## Scope

Current scope is local observability for OpenClaw Gateway sessions. The plugin is not a general analytics backend and does not depend on external services.

## Core Requirements

- Node 20+.
- `npm install` then `npm run build` to build all workspaces.
- Plugin must be installable into OpenClaw and auto-start with Gateway.
- Viewer is expected at `http://localhost:3000/trace`.

## Current Status

The plugin and API surface are implemented. The web viewer exists in a basic raw-event inspection form. Several roadmap items remain incomplete, especially dashboarding, historical log browsing UX, conversation mode, and live SSE consumption in the frontend.
