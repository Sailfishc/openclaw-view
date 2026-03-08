# OpenClaw Plugin 开发指南

> 基于 openclaw-view/trace-viewer 插件开发实践总结，OpenClaw 版本 2026.2.24。

## 1. 插件结构

### 必需文件

```
plugin/
├── openclaw.plugin.json   # 插件清单（id、configSchema、uiHints）
├── package.json           # 需要 openclaw.extensions 声明入口
├── src/
│   └── index.ts           # 导出函数或对象
└── dist/
    ├── index.js           # 编译产物
    └── openclaw.plugin.json  # ⚠️ 必须复制到 dist/（见下方说明）
```

### openclaw.plugin.json

OpenClaw 根据 `load.paths` 里的入口文件定位插件根目录，然后在**同一目录下**查找 `openclaw.plugin.json`。如果入口是 `dist/index.js`，manifest 必须在 `dist/` 里。

**解决方案**：在 `package.json` 的 build 脚本中自动复制：

```json
{
  "scripts": {
    "build": "tsc && cp openclaw.plugin.json dist/"
  }
}
```

### package.json 中的 openclaw.extensions

```json
{
  "openclaw": {
    "extensions": {
      "trace-viewer": "./dist/index.js"
    }
  }
}
```

key 名（`trace-viewer`）必须和 `openclaw.plugin.json` 中的 `id` 一致，否则会出现警告：
```
plugin id mismatch (manifest uses "trace-viewer", entry hints "index")
```

### 导出格式

两种均可：

```typescript
// 函数式（简单场景）
export default (api: PluginApi) => { ... };

// 对象式（推荐，与 dingtalk 等官方插件一致）
export default {
  id: 'trace-viewer',
  name: 'Trace Viewer',
  configSchema: { ... },
  register(api: OpenClawPluginApi) { ... },
};
```

## 2. 两套 Hook 机制（核心区别）

OpenClaw 有**两套完全独立**的 Hook 系统，注册方式、handler 签名、触发时机都不同：

### 2.1 `api.on()` — Agent 生命周期 Hooks

| 属性 | 说明 |
|------|------|
| **注册** | `api.on(hookName, handler, { priority })` |
| **触发时机** | Agent loop 内，每次 LLM 调用时同步执行 |
| **handler 签名** | `(hookCtx: Record<string, unknown>) => ResultObject` |
| **返回值** | 返回对象可修改 prompt/model 等行为 |
| **可用 hooks** | `before_model_resolve`, `before_prompt_build`, `before_agent_start` |

**⚠️ 关键发现：handler 接收单个合并的 context 对象，不是 `(event, ctx)` 两个参数。**

```typescript
// ❌ 错误 — ctx 是 undefined，所有字段读不到
api.on('before_prompt_build', (event, ctx) => {
  const messages = ctx.messages; // undefined!
});

// ✅ 正确 — 从单个对象中读取所有字段
api.on('before_prompt_build', (hookCtx) => {
  const messages = hookCtx.messages;      // ✅ 有值
  const systemPrompt = hookCtx.systemPrompt; // ✅ 有值
  return {}; // 返回空对象 = 不修改
});
```

**可用字段**（`before_prompt_build`）：
- `messages` — 会话消息数组（session load 后可用）
- `tools` — 可用工具列表
- `systemPrompt` — 当前系统提示
- `prependContext`, `appendSystemContext`, `prependSystemContext` — prompt 扩展字段

**可用字段**（`before_model_resolve`）：
- `modelOverride` — 模型覆盖
- `providerOverride` — Provider 覆盖

**优先级**：数值越高越先执行。观察型 hook 用 `-100` 避免干扰：

```typescript
api.on('before_prompt_build', handler, { priority: -100 });
```

### 2.2 `api.registerHook()` — Gateway 事件流 Hooks

| 属性 | 说明 |
|------|------|
| **注册** | `api.registerHook(eventName, handler, { name, description })` |
| **触发时机** | Gateway 事件流分发，由 channel/命令系统 emit |
| **handler 签名** | `(ctx: Record<string, unknown>) => void \| Promise<void>` |
| **返回值** | 一般无意义（`tool_result_persist` 例外，需同步返回） |

**⚠️ 关键发现：handler 也是接收单个 context 对象，不是 `(event, ctx)` 两个参数。**

```typescript
// ❌ 错误
api.registerHook('message:received', async (_event, ctx) => {
  const from = ctx.from; // undefined!
});

// ✅ 正确
api.registerHook('message:received', async (ctx) => {
  const from = ctx.from; // ✅
  const content = ctx.content; // ✅
});
```

**可注册的事件**：

| 事件 | 说明 | 实测状态（2026.2.24） |
|------|------|---------------------|
| `message:received` | 收到入站消息 | ⚠️ 未触发 |
| `message:transcribed` | 音频转录完成 | ⚠️ 未触发 |
| `message:preprocessed` | 消息富化完成 | ⚠️ 未触发 |
| `message:sent` | 出站消息发送成功 | ⚠️ 未触发 |
| `tool_result_persist` | 工具结果持久化前（同步） | ⚠️ 未触发 |
| `session:compact:before` | 压缩前 | 未测试 |
| `session:compact:after` | 压缩后 | 未测试 |
| `command:new` | `/new` 命令 | 未测试 |
| `command:reset` | `/reset` 命令 | 未测试 |
| `command:stop` | `/stop` 命令 | 未测试 |
| `agent:bootstrap` | Agent 启动前 | 未测试 |
| `gateway:startup` | Gateway 启动后 | 未测试 |

### 2.3 实测结论

在 OpenClaw 2026.2.24 + Telegram channel 环境下：

- **`api.on()` 完全正常**：`before_prompt_build` 和 `before_model_resolve` 每次对话都会触发
- **`api.registerHook()` 的 message/tool 事件未触发**：hooks 注册成功（`openclaw hooks list` 显示 ready），但 Gateway 未 emit 这些事件到 hook runner
- 推测 message 事件由 channel 层 emit，可能取决于 channel 实现或 OpenClaw 版本

**实用建议**：当前可靠的数据采集路径是通过 `api.on('before_prompt_build')`，可以获取到：
- `lastUserMessage`（用户发送的内容）
- `messageCount`（消息历史长度）
- `toolsCount` / `toolNames`（工具信息）

## 3. HTTP 路由

### 注册

```typescript
api.registerHttpRoute({
  path: '/trace/api/events',
  auth: 'gateway',  // ⚠️ 重要：用 'gateway' 而不是 'plugin'
  match: 'exact',   // 或 'prefix'
  handler: async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return true;
  },
});
```

### auth 选项

| 值 | 含义 | 适用场景 |
|----|------|---------|
| `'gateway'` | Gateway 统一鉴权保护 | **大多数 API 路由** |
| `'plugin'` | 插件自己负责鉴权 | Webhook 验签等特殊场景 |

**⚠️ `auth: 'plugin'` 意味着 Gateway 不做任何鉴权，你必须在 handler 里自己校验。** 如果不校验，任何能访问 Gateway 端口的客户端都能读数据。

### 路径安全

如果 API 接受文件路径参数，必须做安全校验：

```typescript
import { realpathSync, lstatSync } from 'node:fs';
import { relative } from 'node:path';

function isPathSafe(filePath: string, baseDir: string): boolean {
  // 拒绝 symlink
  if (lstatSync(filePath).isSymbolicLink()) return false;
  // 规范化路径，防止 ../ 逃逸
  const realBase = realpathSync(baseDir);
  const realTarget = realpathSync(filePath);
  const rel = relative(realBase, realTarget);
  return !rel.startsWith('..') && !rel.startsWith('/');
}
```

## 4. Background Service

```typescript
api.registerService({
  id: 'trace-viewer-service',
  start: () => { /* 初始化资源 */ },
  stop: () => { /* 清理资源、关闭连接 */ },
});
```

`stop()` 在 Gateway 关闭时调用，用于释放定时器、SSE 连接、文件句柄等。

## 5. 类型系统

### 现状

当前使用手写的 `PluginApi` 类型近似 SDK 接口。已知问题：
- `registerHook` handler 类型签名不准确（应为单参数）
- `api.on` 参数形态未正确建模

### 推荐

正式集成时应改用 SDK 类型：

```typescript
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
// 或更细粒度的：
import type { ... } from 'openclaw/plugin-sdk/core';
```

## 6. Gateway 管理

### 常用命令

```bash
# 查看状态
openclaw gateway status

# 停止
openclaw gateway stop

# 安装并启动（LaunchAgent）
openclaw gateway install

# 查看 hooks
openclaw hooks list

# 查看插件
openclaw plugins list
```

### 重启注意事项

- `openclaw gateway stop` 停 LaunchAgent，但旧进程可能仍占用端口
- 如果端口冲突，需要 `kill <pid>` 旧进程后再 `openclaw gateway install`
- Gateway 日志位于 `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- 错误日志：`~/.openclaw/logs/gateway.err.log`

## 7. 安装方式

### 链接模式（开发用）

```bash
cd plugin/
openclaw plugins install -l .
```

### load.paths（手动配置）

在 `~/.openclaw/openclaw.json` 中：

```json
{
  "plugins": {
    "entries": {
      "trace-viewer": { "enabled": true, "config": {} }
    },
    "load": {
      "paths": ["/path/to/plugin/dist/index.js"]
    }
  }
}
```

## 8. 踩坑记录

### process.cwd() 不可靠

Gateway 进程的 `process.cwd()` 返回值不稳定，不能用来推断项目名。应使用配置项或固定值。

### init() 时机

插件 `register` 函数在 Gateway 启动早期被调用。如果需要 workspace 路径，应在 `agent:bootstrap` hook 中获取 `ctx.workspaceDir`。

### 同步 I/O

插件运行在 Gateway 进程内，大量同步文件操作（`readFileSync`、`appendFileSync`）会阻塞事件循环。建议：
- 写入用缓冲/批量化
- 读取加缓存（如 stats 缓存）
- 大文件操作改 async

### JSON 格式

日志写入使用 compact JSON（`JSON.stringify(event)`），不要 pretty-print（`JSON.stringify(event, null, 2)`），减少 I/O 量。
