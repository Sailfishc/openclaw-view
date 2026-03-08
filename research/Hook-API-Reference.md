# OpenClaw Hook API 参考

> 基于 Hooks.md 官方文档 + trace-viewer 插件实测验证。

## 事件分类

### Message Events（消息事件）

由 channel 层 emit，需要 channel 支持。

#### `message:received`

入站消息到达时触发（媒体理解之前）。

```typescript
{
  from: string,             // 发送者标识
  content: string,          // 消息内容（可能含 <media:audio> 等占位符）
  timestamp?: number,       // Unix 时间戳
  channelId: string,        // "telegram", "whatsapp", "discord", "dingtalk"
  accountId?: string,       // 多账号场景的账号 ID
  conversationId?: string,  // 会话 ID
  messageId?: string,       // 消息 ID
  metadata?: {
    to?: string,
    provider?: string,
    surface?: string,
    threadId?: string,
    senderId?: string,
    senderName?: string,
    senderUsername?: string,
    senderE164?: string,    // E.164 格式号码（WhatsApp）
  }
}
```

#### `message:transcribed`

音频转录完成后触发。

```typescript
{
  body?: string,            // 原始消息体
  bodyForAgent?: string,    // 富化后的消息体
  transcript: string,       // 音频转录文本
  channelId: string,
  conversationId?: string,
  messageId?: string,
}
```

#### `message:preprocessed`

所有媒体/链接理解完成后触发（agent 看到之前的最终形态）。

```typescript
{
  body?: string,            // 原始消息体
  bodyForAgent?: string,    // 最终富化后的消息体（含转录、图片描述、链接摘要）
  transcript?: string,      // 音频转录（如有）
  channelId: string,
  conversationId?: string,
  messageId?: string,
  isGroup?: boolean,
  groupId?: string,
}
```

#### `message:sent`

出站消息发送成功后触发。

```typescript
{
  to: string,               // 接收者标识
  content: string,          // 发送内容
  success: boolean,         // 是否成功
  error?: string,           // 错误信息
  channelId: string,
  accountId?: string,
  conversationId?: string,
  messageId?: string,       // Provider 返回的消息 ID
  isGroup?: boolean,
  groupId?: string,
}
```

### Command Events（命令事件）

用户执行 `/new`、`/reset`、`/stop` 时触发。

- `command` — 通用监听器（所有命令）
- `command:new` — `/new` 命令
- `command:reset` — `/reset` 命令
- `command:stop` — `/stop` 命令

### Session Events（会话事件）

- `session:compact:before` — 压缩开始前
- `session:compact:after` — 压缩完成后

> 注意：内部 payload 用 `type: "session"` + `action: "compact:before"` 格式 emit。
> 注册时使用合并后的 literal key：`session:compact:before`。

**⚠️ Plugins.md 提到的 `before_compaction` / `after_compaction` 是 plugin hook runner 的别名，
实际注册应使用 `session:compact:before` / `session:compact:after`。**

### Agent Events

- `agent:bootstrap` — workspace 启动文件注入前，可通过 `context.bootstrapFiles` 修改

### Gateway Events

- `gateway:startup` — channels 和 hooks 加载完成后

### Tool Result Hooks

- `tool_result_persist` — 工具结果持久化前。**必须同步**，返回修改后的结果或 `undefined`（保持原样）。

```typescript
api.registerHook(
  'tool_result_persist',
  (toolResult: Record<string, unknown>) => {
    // 同步处理
    console.log('Tool:', toolResult.name);
    return undefined; // 不修改
  },
  { name: 'my-plugin.tool-result' },
);
```

## Agent Lifecycle Hooks（via `api.on`）

这些不是事件流 hooks，而是 agent loop 中的同步扩展点。

### `before_model_resolve`

Session load 之前运行。`messages` 不可用。

```typescript
api.on('before_model_resolve', (hookCtx) => {
  // 可读取/覆盖:
  // hookCtx.modelOverride
  // hookCtx.providerOverride
  return {}; // 不修改
}, { priority: -100 });
```

### `before_prompt_build`

Session load 之后运行。`messages` 可用。

```typescript
api.on('before_prompt_build', (hookCtx) => {
  // 可读取:
  // hookCtx.messages — 消息数组
  // hookCtx.tools — 工具列表
  // hookCtx.systemPrompt
  //
  // 可返回修改:
  // prependContext — 在用户消息前插入文本
  // systemPrompt — 完整替换系统提示
  // prependSystemContext — 在系统提示前插入
  // appendSystemContext — 在系统提示后追加
  return {};
}, { priority: -100 });
```

**Prompt 构建顺序**：
1. 应用 `prependContext` 到用户消息
2. 应用 `systemPrompt` 覆盖（如有）
3. 拼接 `prependSystemContext + 当前系统提示 + appendSystemContext`

### `before_agent_start`（Legacy）

兼容旧版。新代码应使用上面两个明确的 hook。

## 注册方式对比

```
┌─────────────────────┬─────────────────────────────────────────┐
│                     │  api.registerHook()  │    api.on()      │
├─────────────────────┼──────────────────────┼──────────────────┤
│ 触发方              │ Gateway 事件流       │ Agent loop       │
│ handler 参数        │ (ctx) 单参数         │ (hookCtx) 单参数 │
│ 返回值语义          │ 一般无意义           │ 可修改行为       │
│ 异步                │ 支持 async           │ 同步优先         │
│ CLI 可见            │ openclaw hooks list  │ 不可见           │
│ 实测可靠性(2026.2)  │ message 事件未触发   │ ✅ 完全正常      │
└─────────────────────┴──────────────────────┴──────────────────┘
```

## dingtalk 参考

openclaw-channel-dingtalk 作为 channel 插件，不直接使用 `registerHook` 或 `api.on`。它通过 `api.registerChannel({ plugin })` 注册，channel 运行时内部会 emit message 事件。

关键模式：
- 使用 `openclaw/plugin-sdk` 真实类型（`OpenClawPluginApi`, `PluginRuntime`）
- 对象式导出 `{ id, meta, configSchema, ... }`
- 运行时通过 `getDingTalkRuntime()` 全局单例管理
- channel 的 `gateway.startAccount()` 管理生命周期
