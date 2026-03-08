# Trace Viewer 插件架构

## 概述

trace-viewer 是一个 OpenClaw 插件，用于采集、记录和可视化 agent 执行过程中的各类事件。

## 架构图

```
┌──────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                    │
│                                                      │
│  ┌──────────────┐   api.on()    ┌─────────────────┐  │
│  │  Agent Loop   │─────────────▶│  trace-viewer   │  │
│  │              │               │    plugin        │  │
│  │ model:resolve│               │                  │  │
│  │ prompt:build │               │  ┌────────────┐  │  │
│  └──────────────┘               │  │TraceLogger │  │  │
│                                 │  │            │  │  │
│  ┌──────────────┐ registerHook  │  │ .record()  │  │  │
│  │ Hook Runner  │──────────────▶│  │ .getEvents │  │  │
│  │              │  (⚠️ message  │  │ .stats()   │  │  │
│  │ message:*    │   events not  │  └─────┬──────┘  │  │
│  │ command:*    │   emitting)   │        │         │  │
│  │ session:*    │               │        ▼         │  │
│  └──────────────┘               │  ┌──────────┐   │  │
│                                 │  │  .jsonl   │   │  │
│  ┌──────────────┐               │  │  log file │   │  │
│  │  HTTP Server │◀──────────────│  └──────────┘   │  │
│  │              │  registerRoute│        │         │  │
│  │ /trace/api/* │               │        ▼         │  │
│  └──────┬───────┘               │  ┌──────────┐   │  │
│         │                       │  │   SSE     │   │  │
│         ▼                       │  │  clients  │   │  │
│    Gateway Auth                 │  └──────────┘   │  │
│                                 └─────────────────┘  │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   Web Viewer    │
│   (React App)   │
└─────────────────┘
```

## 数据流

### 当前工作路径（api.on）

```
用户发消息 → Telegram Channel → Agent Loop
  → before_model_resolve hook → 记录 model:resolve
  → before_prompt_build hook  → 记录 prompt:build（含 lastUserMessage, messageCount）
  → LLM 调用 → 响应
```

### 期望路径（api.registerHook，未生效）

```
用户发消息 → Telegram Channel
  → emit message:received → Hook Runner → trace-viewer handler → 记录
  → Agent 处理 → 回复
  → emit message:sent → Hook Runner → trace-viewer handler → 记录
```

## 文件存储

### 目录结构

```
~/.openclaw/trace-viewer/
├── <project-name>/              # 按项目分组
│   ├── <project>_20260308_132808.jsonl   # 当前日志
│   └── <project>_20260307_*.jsonl        # 历史日志
```

### 日志格式

每条记录是 compact JSON，记录之间用 `\n---\n` 分隔：

```
{"timestamp":"2026-03-08T05:30:04.340Z","seq":1,"eventType":"prompt:build","payload":{"messageCount":46,"hasSystemPrompt":false,"lastUserMessage":"那就来个清汤的吧。"},"project":"trace-viewer"}
---
```

### 项目命名策略

1. 优先使用 `config.projectName`（用户配置的固定名称）
2. 其次用插件 id（`trace-viewer`）
3. 当 `agent:bootstrap` 触发时，可用 `workspaceDir` 更新为实际项目名

> ⚠️ 不要使用 `process.cwd()`，Gateway 进程的 cwd 不可靠。

### 日志轮转

- 默认单文件上限：300MB
- 超限时自动创建新文件
- 启动时如果找到 1 小时内修改过的日志文件，则续写

## HTTP API

所有路由使用 `auth: 'gateway'`（受 Gateway 统一鉴权保护）。

| 路由 | 方法 | 说明 |
|------|------|------|
| `/trace/api/events` | GET | 返回所有事件 + 统计 |
| `/trace/api/events/since?seq=N` | GET | 增量加载 |
| `/trace/api/stats` | GET | 仅统计信息 |
| `/trace/api/logs` | GET | 列出所有日志文件 |
| `/trace/api/logs/load?path=...` | GET | 加载指定日志文件（有路径安全校验） |
| `/trace/api/sse` | GET | SSE 实时事件流 |

## SSE 协议

```typescript
// 消息格式
data: {"type":"event","data":{...TraceEvent}}\n\n
data: {"type":"full_reload","data":[...TraceEvent[]]}\n\n
data: {"type":"heartbeat","data":[]}\n\n
```

- 新客户端连接时发送 `full_reload`（全量事件）
- 后续新事件发送 `event`
- 每 30 秒 `heartbeat` 保活

## 当前采集能力

### ✅ 可靠采集（via api.on）

| 事件 | 数据 |
|------|------|
| `model:resolve` | modelOverride, providerOverride |
| `prompt:build` | messageCount, hasSystemPrompt, lastUserMessage, toolsCount, toolNames, prependContext, appendSystemContext |

### ⚠️ 已注册但未触发（via registerHook）

| 事件 | 预期数据 |
|------|---------|
| `message:received` | from, content, channelId, messageId, metadata |
| `message:transcribed` | transcript, body, bodyForAgent |
| `message:preprocessed` | bodyForAgent, transcript, isGroup |
| `message:sent` | to, content, success, error |
| `tool_result_persist` | toolName, toolUseId, result, isError |
| `session:compact:*` | phase, messageCount, tokenCount, summary |
| `command:*` | action (new/reset/stop) |
| `agent:bootstrap` | workspaceDir |
| `gateway:startup` | timestamp |

## 已知问题与 TODO

- [ ] `registerHook` 的 message/tool 事件未触发 — 等 OpenClaw 版本更新或确认 channel 层 emit 行为
- [ ] 手写 PluginApi 类型 → 迁移到 `openclaw/plugin-sdk`
- [ ] 函数式导出 → 对象式导出（与生态一致）
- [ ] 同步文件 I/O 优化（写入缓冲、读取异步化）
- [ ] Web Viewer（React App）实现
