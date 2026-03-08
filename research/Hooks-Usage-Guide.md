# Trace Viewer Plugin — Hooks 使用指南

本文档详细说明 Trace Viewer 插件所使用的每个 Hook：它在 Agent 生命周期的哪个阶段触发、能拿到什么数据、我们记录了什么。

> **重要**：这是我们插件的核心依赖。所有可观测性数据都来自这些 Hook，它们的行为变更会直接影响我们的日志完整性。

---

## 总览：一次完整请求的 Hook 触发顺序

```
Gateway 启动
  │
  ├─ gateway:startup              ← Gateway 进程就绪
  ├─ agent:bootstrap              ← Agent 工作区初始化
  │
用户发送消息
  │
  ├─ message_received             ← 收到原始消息
  ├─ message:transcribed          ← 语音转写完成（如有音频）
  ├─ message:preprocessed         ← 媒体/链接理解完成，消息富化后
  │
Agent Loop 开始
  │
  ├─ before_model_resolve         ← 模型选择之前
  ├─ before_prompt_build          ← 组装 prompt 之前（含 messages、tools、system prompt）
  │
  │  ┌─── LLM 推理 ───┐
  │  │  (无 hook 可用)  │           ← ⚠️ 当前无法拦截 LLM 原始请求/响应
  │  └─────────────────┘
  │
  │  如果 LLM 返回 tool_use:
  │  ├─ before_tool_call          ← 工具调用之前（含工具名、参数）
  │  ├─ after_tool_call           ← 工具调用之后（含结果、耗时、错误）
  │  ├─ tool_result_persist       ← 工具结果写入 session 之前
  │  │
  │  └─ (循环: 可能再次 before_prompt_build → LLM → tool_call ...)
  │
  ├─ agent_end                    ← Agent Loop 结束
  │
  │  如果触发 compaction:
  │  ├─ session:compact:before    ← 压缩之前
  │  └─ session:compact:after     ← 压缩之后
  │
回复用户
  │
  ├─ message_sending              ← 消息即将发送
  └─ message_sent                 ← 消息发送完成
  
用户命令
  │
  ├─ command:new                  ← /new 命令
  ├─ command:reset                ← /reset 命令
  └─ command:stop                 ← /stop 命令
```

---

## Hook 详细说明

### 1. Gateway 启动阶段

#### `gateway:startup`

| 项目 | 说明 |
|------|------|
| **触发时机** | Gateway 进程启动完成，Channel 和 Hooks 加载完毕后 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | 无特殊字段 |
| **我们记录的** | `{ timestamp }` |
| **用途** | 标记一次 Gateway 启动，用于分析重启频率和运行时间 |

#### `agent:bootstrap`

| 项目 | 说明 |
|------|------|
| **触发时机** | Agent 工作区初始化时，在 bootstrap 文件注入到 system prompt 之前 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | `workspaceDir` — 工作区目录路径；`bootstrapFiles` — 可变的 bootstrap 文件列表 |
| **我们记录的** | `{ workspaceDir }` |
| **特殊行为** | 如果 `workspaceDir` 可用，会调用 `logger.reinitWithWorkspace()` 切换到正确的项目名 |
| **用途** | 确定实际的工作区路径，初始化正确的项目级日志目录 |

---

### 2. 消息接收阶段

按触发顺序排列。一条入站消息会依次经过这三个阶段：

#### `message_received`

| 项目 | 说明 |
|------|------|
| **触发时机** | 从任意 Channel（WhatsApp、Telegram、Discord 等）收到原始消息时，**早于**媒体处理 |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `from`, `content`, `channelId`, `conversationId`, `messageId`, `metadata`（含 provider、surface、sender 信息等） |
| **我们记录的** | `{ from, content, messageId, metadata }` + channelId, conversationId |
| **注意** | content 可能包含未处理的原始占位符如 `<media:audio>`；此时音频尚未转写 |
| **截断** | content 按 5000 字符截断 |

#### `message:transcribed`

| 项目 | 说明 |
|------|------|
| **触发时机** | 消息经过音频转写和链接理解后。只有包含音频的消息才会触发 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | `body`（原始内容）, `bodyForAgent`（富化后的内容）, `transcript`（转写文本）, `channelId`, `conversationId`, `messageId` |
| **我们记录的** | 全部字段 |
| **截断** | body, bodyForAgent, transcript 各自按 5000 字符截断 |

#### `message:preprocessed`

| 项目 | 说明 |
|------|------|
| **触发时机** | 所有媒体理解（音频转写、图片描述、链接摘要）完成后，在消息交给 Agent 之前 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | `body`, `bodyForAgent`（最终富化版本）, `transcript`, `messageId`, `isGroup`, `groupId`, `channelId`, `conversationId` |
| **我们记录的** | 全部字段 |
| **用途** | 这是看到"Agent 实际收到什么输入"的最佳 hook |

---

### 3. Agent Loop 阶段

#### `before_model_resolve`

| 项目 | 说明 |
|------|------|
| **触发时机** | Session 加载前，模型解析之前。此时 `messages` 还不可用 |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `modelOverride`, `providerOverride` |
| **我们记录的** | `{ modelOverride, providerOverride }` |
| **用途** | 记录本次推理使用的模型和 provider。如果插件通过此 hook 返回 override，可以动态切换模型 |

#### `before_prompt_build` ⭐ 核心 Hook

| 项目 | 说明 |
|------|------|
| **触发时机** | Session 加载完成后，prompt 提交给 LLM 之前。**这是获取完整请求上下文的唯一机会** |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | 完整的合并上下文对象，包含: |
| | `messages` — 完整对话历史（所有 user/assistant/tool 消息）|
| | `tools` — 完整工具定义（name、description、input_schema）|
| | `systemPrompt` — 系统提示词 |
| | `prependContext` — 每轮动态注入的上下文 |
| | `prependSystemContext` / `appendSystemContext` — 系统提示词前缀/后缀 |
| **我们记录的** | 摘要字段: `messageCount`, `hasSystemPrompt`, `toolsCount`, `toolNames`, `lastUserMessage` |
| | 完整字段: `systemPrompt`, `messages[]` (每条消息独立截断), `tools[]` (含 inputSchema) |
| **截断策略** | systemPrompt → 5000 字符；每条 message 的 content 按类型智能截断（text block 截断文本，tool_use block 截断 input，image block 只保留类型信息）；tool inputSchema 序列化后截断 |
| **⚠️ 关键限制** | 这个 hook 只能看到**发给 LLM 的输入**，看不到 LLM 的响应。LLM 的原始响应目前没有 hook 可以拦截 |

#### `before_tool_call`

| 项目 | 说明 |
|------|------|
| **触发时机** | LLM 返回 tool_use 后，实际执行工具之前 |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `toolName`, `toolUseId`, `args`（或 `input`）|
| **我们记录的** | `{ toolName, toolUseId, args }` |
| **用途** | 记录 LLM 决定调用什么工具、传了什么参数。可以用来分析工具使用模式 |

#### `after_tool_call`

| 项目 | 说明 |
|------|------|
| **触发时机** | 工具执行完成后 |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `toolName`, `toolUseId`, `result`, `error`, `duration`, `isError` |
| **我们记录的** | 全部字段，result 截断处理 |
| **用途** | 记录工具执行结果和耗时，是分析工具性能的主要数据源 |

#### `tool_result_persist`

| 项目 | 说明 |
|------|------|
| **触发时机** | 工具结果写入 session transcript 之前 |
| **注册方式** | `api.registerHook()` — **必须同步**（Hooks.md 明确要求）|
| **上下文数据** | `name`（工具名）, `tool_use_id`, `content`（结果内容）, `is_error` |
| **我们记录的** | `{ toolName, toolUseId, result, isError }` |
| **与 after_tool_call 的关系** | 两者记录的内容有重叠。`after_tool_call` 更早触发且有 duration；`tool_result_persist` 是结果最终持久化时的快照，可能经过其他插件的 transform |

#### `agent_end`

| 项目 | 说明 |
|------|------|
| **触发时机** | Agent Loop 完成后（无论成功还是出错）|
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `messages`（完整消息列表）, `status`, `error`, `usage`（token 用量，可能不存在）|
| **我们记录的** | `{ status, messageCount, error, lastAssistantMessage, usage }` |
| **用途** | 标记一轮推理的结束，记录最终状态和 token 消耗 |
| **⚠️ 注意** | `usage` 字段是否可用取决于 OpenClaw 内部实现，可能为 undefined |

---

### 4. Session 管理阶段

#### `session:compact:before`

| 项目 | 说明 |
|------|------|
| **触发时机** | 对话历史过长触发 compaction 时，压缩开始之前 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | `messageCount`（压缩前消息数）, `tokenCount`（压缩前 token 数）|
| **我们记录的** | `{ phase: "before", messageCount, tokenCount }` |

#### `session:compact:after`

| 项目 | 说明 |
|------|------|
| **触发时机** | Compaction 完成后 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | `messageCount`（压缩后消息数）, `tokenCount`（压缩后 token 数）, `summary`（压缩摘要）|
| **我们记录的** | `{ phase: "after", messageCount, tokenCount, summary }` |
| **用途** | 对比 before/after 可以看出压缩比，summary 记录了上下文被如何总结 |

---

### 5. 消息发送阶段

#### `message_sending`

| 项目 | 说明 |
|------|------|
| **触发时机** | 消息即将通过 Channel 发送给用户之前 |
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `to`, `content`, `channelId`, `conversationId`, `messageId` |
| **我们记录的** | 全部字段 |
| **截断** | content 按 5000 字符截断 |
| **用途** | 可以看到即将发送的内容，配合 message_sent 判断是否发送成功 |

#### `message_sent`

| 项目 | 说明 |
|------|------|
| **触发时机** | 消息通过 Channel 发送完成后（无论成功与否）|
| **注册方式** | `api.on()` (plugin hook)，`priority: -100` |
| **上下文数据** | `to`, `content`, `success`, `error`, `channelId`, `conversationId`, `messageId`, `isGroup`, `groupId` |
| **我们记录的** | 全部字段 |
| **截断** | content 按 5000 字符截断 |

---

### 6. 用户命令阶段

#### `command:new` / `command:reset` / `command:stop`

| 项目 | 说明 |
|------|------|
| **触发时机** | 用户执行 `/new`、`/reset`、`/stop` 命令时 |
| **注册方式** | `api.registerHook()` (automation hook) |
| **上下文数据** | 无额外字段 |
| **我们记录的** | `{ action: "new" | "reset" | "stop" }` |
| **用途** | 标记 session 边界，用于日志切分和会话分析 |

---

## 两种注册方式的区别

| | `api.on()` (Plugin Hook) | `api.registerHook()` (Automation Hook) |
|---|---|---|
| **命名风格** | 下划线: `message_received` | 冒号分隔: `message:transcribed` |
| **返回值** | 返回 `{}` 表示不修改上下文 | 返回 `undefined` 或不返回 |
| **同步/异步** | 同步（部分可异步） | 异步（`tool_result_persist` 例外，必须同步）|
| **优先级** | 支持 `priority` 参数（我们用 `-100` 表示仅观察）| 不支持 priority |
| **使用的 Hooks** | `message_received`, `message_sending`, `message_sent`, `before_prompt_build`, `before_model_resolve`, `before_tool_call`, `after_tool_call`, `agent_end` | `message:transcribed`, `message:preprocessed`, `tool_result_persist`, `session:compact:*`, `command:*`, `agent:bootstrap`, `gateway:startup` |

---

## LLM 响应推断：Messages Diff 方案

虽然没有直接的 `after_model_call` hook，但我们通过 **messages 数组差分** 间接还原了 LLM 的返回内容。

### 原理

Agent Loop 中如果 LLM 返回 tool_use，会循环调用 `before_prompt_build`：

```
prompt:build  (messages 数量 = N)
    → LLM 返回 assistant (text + tool_use)     ← 这段没有 hook
    → tool:before_call / tool:after_call
prompt:build  (messages 数量 = N + 2)           ← 多了 assistant + tool_result
    → 此时 messages[N] 就是上一轮 LLM 的 assistant 响应
    → 此时 messages[N+1] 就是 tool_result
```

**我们在第 2 次 `prompt:build` 时，对比上一次的 message 数量，提取新增消息，作为 `model:response` 事件记录下来。**

同理，在 `agent_end` 时，messages 相比最后一次 `prompt:build` 新增的消息，就是最后一轮 LLM 的返回。

### 记录的事件

#### `model:response`（推断事件）

| 项目 | 说明 |
|------|------|
| **触发时机** | `before_prompt_build`（第 2 次及以后）和 `agent_end` 中自动推断 |
| **source** | `"messages_diff"` — 从连续 prompt:build 推断；`"agent_end"` — 从 agent 结束时推断 |
| **newMessages** | 新增的消息数组（assistant 响应 + tool_result 等），每条内容独立截断 |
| **newMessageCount** | 新增消息数量 |
| **previousMessageCount / currentMessageCount** | 前后消息总数，可计算差值 |

### 能还原什么

| 内容 | 是否可还原 | 来源 |
|------|-----------|------|
| Assistant 文本回复 | ✅ | `model:response` newMessages 中 role=assistant 的消息 |
| Tool use 调用（名称+参数） | ✅ | `model:response` newMessages 中的 tool_use blocks + `tool:before_call` |
| Tool 执行结果 | ✅ | `model:response` newMessages 中的 tool_result + `tool:after_call` |
| 多轮 tool 循环的每一轮 | ✅ | 每次循环都会产生一个 `model:response` |
| LLM 最终回复 | ✅ | source=agent_end 的 `model:response` |

### 仍然无法获取的

| 内容 | 原因 |
|------|------|
| stop_reason（end_turn / tool_use / max_tokens） | 不在 messages 中 |
| 每轮 token 用量 | 无逐轮 hook，只有 `agent_end` 的汇总 usage（可能不存在） |
| model 参数（temperature / max_tokens） | `before_model_resolve` 只有 model 名称 |
| Streaming delta | pi-agent-core 内部事件，plugin hook 不暴露 |
| 重试 / fallback | 无 hook |

---

## 剩余覆盖盲区

| 盲区 | 说明 | 影响 |
|------|------|------|
| **API 级参数** | temperature、max_tokens、top_p 等推理参数 | 无 hook 暴露 |
| **逐轮 Token 用量** | 每次 LLM 调用的 input/output tokens | 只有 agent_end 可能有汇总 |
| **Streaming 事件** | Assistant 流式输出 delta | pi-agent-core 事件，不在 plugin hook 范围 |
| **重试和 Fallback** | 模型调用失败后的重试 | 无 hook 暴露 |

### 可能的改进方向

1. **向 OpenClaw 提议新 Hook**：`after_model_call`（含完整 LLM 响应、stop_reason、usage）
2. **Stream 事件桥接**：如果 OpenClaw 开放 pi-agent-core 事件订阅，可以捕获 streaming delta
3. **HTTP 层拦截**：作为最后手段，可以 patch fetch/http 来捕获原始 API 调用（侵入性强，不推荐）
