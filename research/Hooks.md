---
title: "Hooks"
source: "https://docs.openclaw.ai/automation/hooks"
author:
  - "[[OpenClaw]]"
published:
created: 2026-03-08
description:
tags:
  - "clippings"
---
## Hooks

Hooks provide an extensible event-driven system for automating actions in response to agent commands and events. Hooks are automatically discovered from directories and can be managed via CLI commands, similar to how skills work in OpenClaw.

## Getting Oriented

Hooks are small scripts that run when something happens. There are two kinds:
- **Hooks** (this page): run inside the Gateway when agent events fire, like `/new`, `/reset`, `/stop`, or lifecycle events.
- **Webhooks**: external HTTP webhooks that let other systems trigger work in OpenClaw. See [Webhook Hooks](https://docs.openclaw.ai/automation/webhook) or use `openclaw webhooks` for Gmail helper commands.
Hooks can also be bundled inside plugins; see [Plugins](https://docs.openclaw.ai/tools/plugin#plugin-hooks).Common uses:
- Save a memory snapshot when you reset a session
- Keep an audit trail of commands for troubleshooting or compliance
- Trigger follow-up automation when a session starts or ends
- Write files into the agent workspace or call external APIs when events fire
If you can write a small TypeScript function, you can write a hook. Hooks are discovered automatically, and you enable or disable them via the CLI.

## Overview

The hooks system allows you to:
- Save session context to memory when `/new` is issued
- Log all commands for auditing
- Trigger custom automations on agent lifecycle events
- Extend OpenClaw’s behavior without modifying core code

## Getting Started

### Bundled Hooks

OpenClaw ships with four bundled hooks that are automatically discovered:
- **💾 session-memory**: Saves session context to your agent workspace (default `~/.openclaw/workspace/memory/`) when you issue `/new`
- **📎 bootstrap-extra-files**: Injects additional workspace bootstrap files from configured glob/path patterns during `agent:bootstrap`
- **📝 command-logger**: Logs all command events to `~/.openclaw/logs/commands.log`
- **🚀 boot-md**: Runs `BOOT.md` when the gateway starts (requires internal hooks enabled)
List available hooks:Enable a hook:Check hook status:Get detailed information:

### Onboarding

During onboarding (`openclaw onboard`), you’ll be prompted to enable recommended hooks. The wizard automatically discovers eligible hooks and presents them for selection.

## Hook Discovery

Hooks are automatically discovered from three directories (in order of precedence):
1. **Workspace hooks**: `<workspace>/hooks/` (per-agent, highest precedence)
2. **Managed hooks**: `~/.openclaw/hooks/` (user-installed, shared across workspaces)
3. **Bundled hooks**: `<openclaw>/dist/hooks/bundled/` (shipped with OpenClaw)
Managed hook directories can be either a **single hook** or a **hook pack** (package directory).Each hook is a directory containing:

## Hook Packs (npm/archives)

Hook packs are standard npm packages that export one or more hooks via `openclaw.hooks` in `package.json`. Install them with:Npm specs are registry-only (package name + optional exact version or dist-tag). Git/URL/file specs and semver ranges are rejected.Bare specs and `@latest` stay on the stable track. If npm resolves either of those to a prerelease, OpenClaw stops and asks you to opt in explicitly with a prerelease tag such as `@beta` / `@rc` or an exact prerelease version.Example `package.json`:Each entry points to a hook directory containing `HOOK.md` and `handler.ts` (or `index.ts`). Hook packs can ship dependencies; they will be installed under `~/.openclaw/hooks/<id>`. Each `openclaw.hooks` entry must stay inside the package directory after symlink resolution; entries that escape are rejected.Security note: `openclaw hooks install` installs dependencies with `npm install --ignore-scripts` (no lifecycle scripts). Keep hook pack dependency trees “pure JS/TS” and avoid packages that rely on `postinstall` builds.

## Hook Structure

### HOOK.md Format

The `HOOK.md` file contains metadata in YAML frontmatter plus Markdown documentation:The `metadata.openclaw` object supports:
- **`emoji`**: Display emoji for CLI (e.g., `"💾"`)
- **`events`**: Array of events to listen for (e.g., `["command:new", "command:reset"]`)
- **`export`**: Named export to use (defaults to `"default"`)
- **`homepage`**: Documentation URL
- **`requires`**: Optional requirements
	- **`bins`**: Required binaries on PATH (e.g., `["git", "node"]`)
	- **`anyBins`**: At least one of these binaries must be present
	- **`env`**: Required environment variables
	- **`config`**: Required config paths (e.g., `["workspace.dir"]`)
	- **`os`**: Required platforms (e.g., `["darwin", "linux"]`)
- **`always`**: Bypass eligibility checks (boolean)
- **`install`**: Installation methods (for bundled hooks: `[{"id":"bundled","kind":"bundled"}]`)

### Handler Implementation

The `handler.ts` file exports a `HookHandler` function:

#### Event Context

Each event includes:

## Event Types

### Command Events

Triggered when agent commands are issued:
- **`command`**: All command events (general listener)
- **`command:new`**: When `/new` command is issued
- **`command:reset`**: When `/reset` command is issued
- **`command:stop`**: When `/stop` command is issued

### Session Events

- **`session:compact:before`**: Right before compaction summarizes history
- **`session:compact:after`**: After compaction completes with summary metadata
Internal hook payloads emit these as `type: "session"` with `action: "compact:before"` / `action: "compact:after"`; listeners subscribe with the combined keys above. Specific handler registration uses the literal key format `${type}:${action}`. For these events, register `session:compact:before` and `session:compact:after`.

### Agent Events

- **`agent:bootstrap`**: Before workspace bootstrap files are injected (hooks may mutate `context.bootstrapFiles`)

### Gateway Events

Triggered when the gateway starts:
- **`gateway:startup`**: After channels start and hooks are loaded

### Message Events

Triggered when messages are received or sent:
- **`message`**: All message events (general listener)
- **`message:received`**: When an inbound message is received from any channel. Fires early in processing before media understanding. Content may contain raw placeholders like `<media:audio>` for media attachments that haven’t been processed yet.
- **`message:transcribed`**: When a message has been fully processed, including audio transcription and link understanding. At this point, `transcript` contains the full transcript text for audio messages. Use this hook when you need access to transcribed audio content.
- **`message:preprocessed`**: Fires for every message after all media + link understanding completes, giving hooks access to the fully enriched body (transcripts, image descriptions, link summaries) before the agent sees it.
- **`message:sent`**: When an outbound message is successfully sent

#### Message Event Context

Message events include rich context about the message:

```
// message:received context

{

  from: string,           // Sender identifier (phone number, user ID, etc.)

  content: string,        // Message content

  timestamp?: number,     // Unix timestamp when received

  channelId: string,      // Channel (e.g., "whatsapp", "telegram", "discord")

  accountId?: string,     // Provider account ID for multi-account setups

  conversationId?: string, // Chat/conversation ID

  messageId?: string,     // Message ID from the provider

  metadata?: {            // Additional provider-specific data

    to?: string,

    provider?: string,

    surface?: string,

    threadId?: string,

    senderId?: string,

    senderName?: string,

    senderUsername?: string,

    senderE164?: string,

  }

}

// message:sent context

{

  to: string,             // Recipient identifier

  content: string,        // Message content that was sent

  success: boolean,       // Whether the send succeeded

  error?: string,         // Error message if sending failed

  channelId: string,      // Channel (e.g., "whatsapp", "telegram", "discord")

  accountId?: string,     // Provider account ID

  conversationId?: string, // Chat/conversation ID

  messageId?: string,     // Message ID returned by the provider

  isGroup?: boolean,      // Whether this outbound message belongs to a group/channel context

  groupId?: string,       // Group/channel identifier for correlation with message:received

}

// message:transcribed context

{

  body?: string,          // Raw inbound body before enrichment

  bodyForAgent?: string,  // Enriched body visible to the agent

  transcript: string,     // Audio transcript text

  channelId: string,      // Channel (e.g., "telegram", "whatsapp")

  conversationId?: string,

  messageId?: string,

}

// message:preprocessed context

{

  body?: string,          // Raw inbound body

  bodyForAgent?: string,  // Final enriched body after media/link understanding

  transcript?: string,    // Transcript when audio was present

  channelId: string,      // Channel (e.g., "telegram", "whatsapp")

  conversationId?: string,

  messageId?: string,

  isGroup?: boolean,

  groupId?: string,

}
```

#### Example: Message Logger Hook

### Tool Result Hooks (Plugin API)

These hooks are not event-stream listeners; they let plugins synchronously adjust tool results before OpenClaw persists them.
- **`tool_result_persist`**: transform tool results before they are written to the session transcript. Must be synchronous; return the updated tool result payload or `undefined` to keep it as-is. See [Agent Loop](https://docs.openclaw.ai/concepts/agent-loop).

### Plugin Hook Events

Compaction lifecycle hooks exposed through the plugin hook runner:
- **`before_compaction`**: Runs before compaction with count/token metadata
- **`after_compaction`**: Runs after compaction with compaction summary metadata

### Future Events

Planned event types:
- **`session:start`**: When a new session begins
- **`session:end`**: When a session ends
- **`agent:error`**: When an agent encounters an error

## Creating Custom Hooks

### 1\. Choose Location

- **Workspace hooks** (`<workspace>/hooks/`): Per-agent, highest precedence
- **Managed hooks** (`~/.openclaw/hooks/`): Shared across workspaces

### 2\. Create Directory Structure

### 3\. Create HOOK.md

### 4\. Create handler.ts

### 5\. Enable and Test

## Configuration

### Per-Hook Configuration

Hooks can have custom configuration:

### Extra Directories

Load hooks from additional directories:

### Legacy Config Format (Still Supported)

The old config format still works for backwards compatibility:Note: `module` must be a workspace-relative path. Absolute paths and traversal outside the workspace are rejected.**Migration**: Use the new discovery-based system for new hooks. Legacy handlers are loaded after directory-based hooks.

## CLI Commands

### List Hooks

### Hook Information

### Check Eligibility

### Enable/Disable

## Bundled hook reference

### session-memory

Saves session context to memory when you issue `/new`.**Events**: `command:new` **Requirements**: `workspace.dir` must be configured **Output**: `<workspace>/memory/YYYY-MM-DD-slug.md` (defaults to `~/.openclaw/workspace`) **What it does**:
1. Uses the pre-reset session entry to locate the correct transcript
2. Extracts the last 15 lines of conversation
3. Uses LLM to generate a descriptive filename slug
4. Saves session metadata to a dated memory file
**Example output**:**Filename examples**:
- `2026-01-16-vendor-pitch.md`
- `2026-01-16-api-design.md`
- `2026-01-16-1430.md` (fallback timestamp if slug generation fails)
**Enable**:

### bootstrap-extra-files

Injects additional bootstrap files (for example monorepo-local `AGENTS.md` / `TOOLS.md`) during `agent:bootstrap`.**Events**: `agent:bootstrap` **Requirements**: `workspace.dir` must be configured **Output**: No files written; bootstrap context is modified in-memory only.**Config**:**Notes**:
- Paths are resolved relative to workspace.
- Files must stay inside workspace (realpath-checked).
- Only recognized bootstrap basenames are loaded.
- Subagent allowlist is preserved (`AGENTS.md` and `TOOLS.md` only).
**Enable**:

### command-logger

Logs all command events to a centralized audit file.**Events**: `command` **Requirements**: None **Output**: `~/.openclaw/logs/commands.log` **What it does**:
1. Captures event details (command action, timestamp, session key, sender ID, source)
2. Appends to log file in JSONL format
3. Runs silently in the background
**Example log entries**:**View logs**:**Enable**:

### boot-md

Runs `BOOT.md` when the gateway starts (after channels start). Internal hooks must be enabled for this to run.**Events**: `gateway:startup` **Requirements**: `workspace.dir` must be configured **What it does**:
1. Reads `BOOT.md` from your workspace
2. Runs the instructions via the agent runner
3. Sends any requested outbound messages via the message tool
**Enable**:

## Best Practices

### Keep Handlers Fast

Hooks run during command processing. Keep them lightweight:Always wrap risky operations:

### Filter Events Early

Return early if the event isn’t relevant:

### Use Specific Event Keys

Specify exact events in metadata when possible:Rather than:

## Debugging

### Enable Hook Logging

The gateway logs hook loading at startup:

### Check Discovery

List all discovered hooks:

### Check Registration

In your handler, log when it’s called:

### Verify Eligibility

Check why a hook isn’t eligible:Look for missing requirements in the output.

## Testing

### Gateway Logs

Monitor gateway logs to see hook execution:

### Test Hooks Directly

Test your handlers in isolation:

## Architecture

### Core Components

- **`src/hooks/types.ts`**: Type definitions
- **`src/hooks/workspace.ts`**: Directory scanning and loading
- **`src/hooks/frontmatter.ts`**: HOOK.md metadata parsing
- **`src/hooks/config.ts`**: Eligibility checking
- **`src/hooks/hooks-status.ts`**: Status reporting
- **`src/hooks/loader.ts`**: Dynamic module loader
- **`src/cli/hooks-cli.ts`**: CLI commands
- **`src/gateway/server-startup.ts`**: Loads hooks at gateway start
- **`src/auto-reply/reply/commands-core.ts`**: Triggers command events

### Discovery Flow

### Event Flow

## Troubleshooting

### Hook Not Discovered

1. Check directory structure:
2. Verify HOOK.md format:
3. List all discovered hooks:

### Hook Not Eligible

Check requirements:Look for missing:
- Binaries (check PATH)
- Environment variables
- Config values
- OS compatibility

### Hook Not Executing

1. Verify hook is enabled:
2. Restart your gateway process so hooks reload.
3. Check gateway logs for errors:
Check for TypeScript/import errors:

## Migration Guide

### From Legacy Config to Discovery

**Before**:**After**:
1. Create hook directory:
2. Create HOOK.md:
3. Update config:
4. Verify and restart your gateway process:
**Benefits of migration**:
- Automatic discovery
- CLI management
- Eligibility checking
- Better documentation
- Consistent structure

## See Also

- [CLI Reference: hooks](https://docs.openclaw.ai/cli/hooks)
- [Bundled Hooks README](https://github.com/openclaw/openclaw/tree/main/src/hooks/bundled)
- [Webhook Hooks](https://docs.openclaw.ai/automation/webhook)
- [Configuration](https://docs.openclaw.ai/gateway/configuration#hooks)

[OpenProse](https://docs.openclaw.ai/prose) [Cron Jobs](https://docs.openclaw.ai/automation/cron-jobs)