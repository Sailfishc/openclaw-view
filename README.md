# OpenClaw Trace Viewer

An OpenClaw plugin that tracks and visualizes execution traces — message lifecycle, tool calls, model selection, and session events — in real time.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  OpenClaw Gateway                │
│                                                  │
│  message:received ──┐                            │
│  message:preprocessed ──┐                        │
│  message:sent ──────────┤                        │
│  before_prompt_build ───┤   ┌─────────────────┐  │
│  before_model_resolve ──┼──▶│  Trace Viewer   │  │
│  tool_result_persist ───┤   │    Plugin       │  │
│  session:compact ───────┤   │                 │  │
│  command:new/reset/stop ┤   │  ┌───────────┐  │  │
│  agent:bootstrap ───────┤   │  │  Logger   │  │  │
│  gateway:startup ───────┘   │  │ (JSONL)   │  │  │
│                             │  └─────┬─────┘  │  │
│                             │        │        │  │
│                             │    ┌───▼────┐   │  │
│                             │    │  SSE   │   │  │
│                             │    │ Stream │   │  │
│                             │    └───┬────┘   │  │
│                             └────────┼────────┘  │
│                                      │           │
│   HTTP Routes: /trace/api/*  ◄───────┘           │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│   Web Viewer     │
│  (React + Vite)  │
│   Phase 2 🚧     │
└──────────────────┘
```

## Project Structure

```
openclaw-view/
├── shared/              # Shared type definitions
│   └── src/index.ts     # TraceEvent, EventPayload, TraceStats
├── plugin/              # OpenClaw plugin (core)
│   ├── openclaw.plugin.json   # Plugin manifest
│   └── src/
│       ├── index.ts           # Entry: hooks + HTTP routes + service
│       ├── trace-logger.ts    # Log management, SSE, file rotation
│       └── types.ts           # OpenClaw Plugin API types
├── web/                 # Viewer frontend (Phase 2)
│   └── src/App.tsx
└── research/            # Reference documentation
```

## Hook Coverage

| Hook | Category | Purpose |
|---|---|---|
| `message:received` | Message | Record inbound messages |
| `message:preprocessed` | Message | Record enriched content before agent sees it |
| `message:sent` | Message | Record outbound messages, track response time |
| `before_prompt_build` | Agent | Capture prompt construction (message count, tools, context) |
| `before_model_resolve` | Agent | Record model/provider selection |
| `tool_result_persist` | Tool | Record tool call results |
| `session:compact:before/after` | Session | Track context compaction events |
| `command:new/reset/stop` | Command | Mark session boundaries |
| `agent:bootstrap` | Lifecycle | Record agent startup |
| `gateway:startup` | Lifecycle | Record gateway startup |

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /trace/api/events` | All events + computed stats |
| `GET /trace/api/events/since?seq=N` | Incremental event loading |
| `GET /trace/api/stats` | Stats only |
| `GET /trace/api/logs` | List all log files by project |
| `GET /trace/api/logs/load?path=...` | Load a specific historical log file |
| `GET /trace/api/sse` | Server-Sent Events stream (real-time) |

## Log Format

Logs are stored as `\n---\n`-separated JSON records (inspired by [cc-viewer](https://github.com/weiesky/cc-viewer)):

```
~/.openclaw/trace-viewer/{project}/{project}_{timestamp}.jsonl
```

Each record:

```json
{
  "timestamp": "2026-03-08T12:00:00.000Z",
  "seq": 0,
  "eventType": "message:received",
  "channelId": "telegram",
  "conversationId": "chat_123",
  "payload": {
    "from": "user123",
    "content": "Hello, help me with..."
  },
  "project": "my-project"
}
```

Features:
- Auto-resume logs modified within 1 hour
- Auto-rotate at 300MB (configurable)
- Content truncation at 5000 chars (configurable)
- Per-project directory isolation

## Configuration

In your OpenClaw config under `plugins.entries.trace-viewer.config`:

```json
{
  "logDir": "~/.openclaw/trace-viewer/",
  "maxLogSize": 300,
  "truncateContentAt": 5000
}
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Build plugin only
npm run build:plugin

# Watch plugin for changes
npm run dev:plugin
```

## Tech Stack

- **Plugin**: TypeScript, Node.js built-in modules
- **Shared**: TypeScript type definitions
- **Web** (Phase 2): React 18, Vite 6, Ant Design

## Usage

1. Build the project:
```bash
npm install
npm run build
```

2. Start OpenClaw with the plugin enabled

3. Open the web viewer:
```
http://localhost:3000/trace
```

The viewer will display all trace events in real-time.

## Roadmap

- [x] Plugin: Hook interception (11 event types)
- [x] Plugin: JSONL log management (write, rotate, resume)
- [x] Plugin: HTTP API (6 endpoints)
- [x] Plugin: SSE real-time push
- [x] Web: Event list (Raw mode)
- [x] Web: Event detail panel
- [ ] Web: Stats dashboard
- [ ] Web: Log file browser
- [ ] Web: Conversation mode
- [ ] Web: Real-time SSE updates

## License

MIT
