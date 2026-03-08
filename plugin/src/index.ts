// ============================================================
// OpenClaw Trace Viewer Plugin — Entry Point
// ============================================================
//
// Registers hooks to intercept execution events and exposes
// HTTP routes for the viewer UI and API.
//
// Hook coverage:
//   [api.on]  message_received, message_sending, message_sent
//   [api.on]  before_prompt_build, before_model_resolve
//   [api.on]  before_tool_call, after_tool_call, agent_end
//   [registerHook] message:transcribed, message:preprocessed
//   [registerHook] tool_result_persist
//   [registerHook] session:compact:before/after, command:new/reset/stop
//   [registerHook] agent:bootstrap, gateway:startup
// ============================================================

import { TraceLogger } from './trace-logger.js';
import type { PluginApi, PluginConfig } from './types.js';
import type {
  MessageReceivedPayload,
  MessageTranscribedPayload,
  MessagePreprocessedPayload,
  MessageSendingPayload,
  MessageSentPayload,
  PromptBuildPayload,
  ModelResolvePayload,
  BeforeToolCallPayload,
  AfterToolCallPayload,
  ToolResultPersistPayload,
  AgentEndPayload,
  EventsResponse,
} from '@openclaw-view/shared';

const PLUGIN_PREFIX = 'trace-viewer';

export default (api: PluginApi) => {
  const config: PluginConfig = (api.config ?? {}) as PluginConfig;
  const logger = new TraceLogger(config, api.logger);

  // Initialize on startup with a fixed project name.
  // Gateway process.cwd() is unreliable, so we derive the name from config
  // or fall back to the plugin id. The agent:bootstrap hook will re-init
  // with the actual workspace directory when it fires.
  const projectName = config.projectName || PLUGIN_PREFIX;
  logger.init(projectName);

  api.logger.info('[trace-viewer] Plugin loaded');

  // =============================================================
  // Message Lifecycle Hooks (api.on — plugin hooks)
  //
  // Agent Loop docs list message_received / message_sending /
  // message_sent as plugin hooks (underscore naming, api.on).
  // message:transcribed and message:preprocessed are only in the
  // automation hooks system — we keep registerHook for those as
  // fallback but also try api.on for resilience.
  // =============================================================

  api.on(
    'message_received',
    (ctx: Record<string, unknown>) => {
      const payload: MessageReceivedPayload = {
        from: String(ctx.from ?? ''),
        content: logger.truncate(String(ctx.content ?? '')) ?? '',
        messageId: ctx.messageId as string | undefined,
        metadata: ctx.metadata as MessageReceivedPayload['metadata'],
      };
      logger.record({
        eventType: 'message:received',
        payload,
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
      });
      return {};
    },
    { priority: -100 },
  );

  // message:transcribed — only exists in automation hooks, not
  // listed as a plugin hook in Agent Loop docs.
  api.registerHook(
    'message:transcribed',
    async (ctx: Record<string, unknown>) => {
      const payload: MessageTranscribedPayload = {
        body: logger.truncate(ctx.body as string | undefined),
        bodyForAgent: logger.truncate(ctx.bodyForAgent as string | undefined),
        transcript: logger.truncate(ctx.transcript as string | undefined),
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
        messageId: ctx.messageId as string | undefined,
      };
      logger.record({
        eventType: 'message:transcribed',
        payload,
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
      });
    },
    { name: `${PLUGIN_PREFIX}.message-transcribed`, description: 'Record transcribed messages' },
  );

  // message:preprocessed — only exists in automation hooks.
  api.registerHook(
    'message:preprocessed',
    async (ctx: Record<string, unknown>) => {
      const payload: MessagePreprocessedPayload = {
        body: logger.truncate(ctx.body as string | undefined),
        bodyForAgent: logger.truncate(ctx.bodyForAgent as string | undefined),
        transcript: logger.truncate(ctx.transcript as string | undefined),
        messageId: ctx.messageId as string | undefined,
        isGroup: ctx.isGroup as boolean | undefined,
        groupId: ctx.groupId as string | undefined,
      };
      logger.record({
        eventType: 'message:preprocessed',
        payload,
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
      });
    },
    { name: `${PLUGIN_PREFIX}.message-preprocessed`, description: 'Record preprocessed messages' },
  );

  api.on(
    'message_sending',
    (ctx: Record<string, unknown>) => {
      const payload: MessageSendingPayload = {
        to: ctx.to as string | undefined,
        content: logger.truncate(ctx.content as string | undefined),
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
        messageId: ctx.messageId as string | undefined,
      };
      logger.record({
        eventType: 'message:sending',
        payload,
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
      });
      return {};
    },
    { priority: -100 },
  );

  api.on(
    'message_sent',
    (ctx: Record<string, unknown>) => {
      const payload: MessageSentPayload = {
        to: String(ctx.to ?? ''),
        content: logger.truncate(String(ctx.content ?? '')) ?? '',
        success: Boolean(ctx.success),
        error: ctx.error as string | undefined,
        messageId: ctx.messageId as string | undefined,
        isGroup: ctx.isGroup as boolean | undefined,
        groupId: ctx.groupId as string | undefined,
      };
      logger.record({
        eventType: 'message:sent',
        payload,
        channelId: ctx.channelId as string | undefined,
        conversationId: ctx.conversationId as string | undefined,
      });
      return {};
    },
    { priority: -100 },
  );

  // =============================================================
  // Agent Lifecycle Hooks
  // =============================================================

  // api.on() lifecycle hooks receive a single merged context object,
  // NOT (event, ctx) two parameters. The context contains both
  // event fields (systemPrompt, prependContext, etc.) and session
  // fields (messages, tools, etc.).
  api.on(
    'before_prompt_build',
    (hookCtx: Record<string, unknown>) => {
      const messages = hookCtx.messages as unknown[] | undefined;
      const tools = hookCtx.tools as Array<{ name: string }> | undefined;

      // Extract last user message for context
      let lastUserMessage: string | undefined;
      if (Array.isArray(messages)) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as { role?: string; content?: unknown };
          if (msg?.role === 'user') {
            const content = msg.content;
            if (typeof content === 'string') {
              lastUserMessage = content;
            } else if (Array.isArray(content)) {
              const textBlock = (content as Array<{ type: string; text?: string }>)
                .find((b) => b.type === 'text');
              lastUserMessage = textBlock?.text;
            }
            break;
          }
        }
      }

      const payload: PromptBuildPayload = {
        messageCount: Array.isArray(messages) ? messages.length : undefined,
        hasSystemPrompt: hookCtx.systemPrompt !== undefined,
        prependContext: logger.truncate(hookCtx.prependContext as string | undefined),
        appendSystemContext: logger.truncate(hookCtx.appendSystemContext as string | undefined),
        prependSystemContext: logger.truncate(hookCtx.prependSystemContext as string | undefined),
        lastUserMessage: logger.truncate(lastUserMessage),
        toolsCount: Array.isArray(tools) ? tools.length : undefined,
        toolNames: Array.isArray(tools) ? tools.map((t) => t.name).slice(0, 50) : undefined,
      };

      logger.record({ eventType: 'prompt:build', payload });

      // Return empty — we don't modify the prompt
      return {};
    },
    { priority: -100 }, // Low priority: observe only
  );

  api.on(
    'before_model_resolve',
    (hookCtx: Record<string, unknown>) => {
      const payload: ModelResolvePayload = {
        modelOverride: hookCtx.modelOverride as string | undefined,
        providerOverride: hookCtx.providerOverride as string | undefined,
      };
      logger.record({ eventType: 'model:resolve', payload });
      return {};
    },
    { priority: -100 },
  );

  // =============================================================
  // Tool Lifecycle Hooks (api.on — plugin hooks)
  // =============================================================

  api.on(
    'before_tool_call',
    (ctx: Record<string, unknown>) => {
      const payload: BeforeToolCallPayload = {
        toolName: ctx.toolName as string | undefined,
        toolUseId: ctx.toolUseId as string | undefined,
        args: ctx.args ?? ctx.input,
      };
      logger.record({ eventType: 'tool:before_call', payload });
      return {};
    },
    { priority: -100 },
  );

  api.on(
    'after_tool_call',
    (ctx: Record<string, unknown>) => {
      const payload: AfterToolCallPayload = {
        toolName: ctx.toolName as string | undefined,
        toolUseId: ctx.toolUseId as string | undefined,
        result: truncateResult(ctx.result, logger),
        error: ctx.error as string | undefined,
        duration: ctx.duration as number | undefined,
        isError: ctx.isError as boolean | undefined,
      };
      logger.record({ eventType: 'tool:after_call', payload });
      return {};
    },
    { priority: -100 },
  );

  // tool_result_persist — synchronous hook via registerHook.
  // Hooks.md explicitly says this is a Plugin API hook that must
  // be synchronous. Keep registerHook for now; if it doesn't fire,
  // after_tool_call above covers the same ground.
  api.registerHook(
    'tool_result_persist',
    (toolResult: Record<string, unknown>) => {
      const payload: ToolResultPersistPayload = {
        toolName: toolResult.name as string | undefined,
        toolUseId: toolResult.tool_use_id as string | undefined,
        result: truncateResult(toolResult.content, logger),
        isError: toolResult.is_error as boolean | undefined,
      };
      logger.record({ eventType: 'tool_result:persist', payload });
      return undefined;
    },
    { name: `${PLUGIN_PREFIX}.tool-result`, description: 'Record tool results' },
  );

  // =============================================================
  // Agent End Hook (api.on — plugin hook)
  // =============================================================

  api.on(
    'agent_end',
    (ctx: Record<string, unknown>) => {
      const messages = ctx.messages as unknown[] | undefined;
      const payload: AgentEndPayload = {
        status: ctx.status as string | undefined,
        messageCount: Array.isArray(messages) ? messages.length : undefined,
        error: ctx.error as string | undefined,
      };
      logger.record({ eventType: 'agent:end', payload });
      return {};
    },
    { priority: -100 },
  );

  // =============================================================
  // Session Events
  // =============================================================

  api.registerHook(
    'session:compact:before',
    async (ctx: Record<string, unknown>) => {
      logger.record({
        eventType: 'session:compact',
        payload: {
          phase: 'before' as const,
          messageCount: ctx.messageCount as number | undefined,
          tokenCount: ctx.tokenCount as number | undefined,
        },
      });
    },
    { name: `${PLUGIN_PREFIX}.compact-before` },
  );

  api.registerHook(
    'session:compact:after',
    async (ctx: Record<string, unknown>) => {
      logger.record({
        eventType: 'session:compact',
        payload: {
          phase: 'after' as const,
          messageCount: ctx.messageCount as number | undefined,
          tokenCount: ctx.tokenCount as number | undefined,
          summary: logger.truncate(ctx.summary as string | undefined),
        },
      });
    },
    { name: `${PLUGIN_PREFIX}.compact-after` },
  );

  // =============================================================
  // Command Events
  // =============================================================

  for (const cmd of ['command:new', 'command:reset', 'command:stop']) {
    const action = cmd.split(':')[1];
    api.registerHook(
      cmd,
      async () => {
        logger.record({
          eventType: 'command',
          payload: { action },
        });
      },
      { name: `${PLUGIN_PREFIX}.${cmd}` },
    );
  }

  // =============================================================
  // Optional: Startup Events
  // =============================================================

  api.registerHook(
    'agent:bootstrap',
    async (ctx: Record<string, unknown>) => {
      // Re-initialize with workspace directory if available
      const workspaceDir = ctx.workspaceDir as string | undefined;
      if (workspaceDir) {
        logger.reinitWithWorkspace(workspaceDir);
      }
      logger.record({
        eventType: 'agent:bootstrap',
        payload: { workspaceDir },
      });
    },
    { name: `${PLUGIN_PREFIX}.bootstrap` },
  );

  api.registerHook(
    'gateway:startup',
    async () => {
      logger.record({
        eventType: 'gateway:startup',
        payload: { timestamp: new Date().toISOString() },
      });
    },
    { name: `${PLUGIN_PREFIX}.gateway-startup` },
  );

  // =============================================================
  // HTTP Routes — API
  // =============================================================

  // GET /trace/api/events — return all events + stats
  api.registerHttpRoute({
    path: '/trace/api/events',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      const response: EventsResponse = {
        events: logger.getEvents(),
        stats: logger.computeStats(),
      };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(response));
      return true;
    },
  });

  // GET /trace/api/events?since=N — incremental load
  api.registerHttpRoute({
    path: '/trace/api/events/since',
    auth: 'gateway',
    match: 'prefix',
    handler: async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost');
      const since = parseInt(url.searchParams.get('seq') || '0', 10);
      const events = logger.getEventsSince(since);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ events }));
      return true;
    },
  });

  // GET /trace/api/stats — stats only
  api.registerHttpRoute({
    path: '/trace/api/stats',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(logger.computeStats()));
      return true;
    },
  });

  // GET /trace/api/logs — list all log files
  api.registerHttpRoute({
    path: '/trace/api/logs',
    auth: 'gateway',
    match: 'exact',
    handler: async (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(logger.listLogFiles()));
      return true;
    },
  });

  // GET /trace/api/logs/load?path=... — load specific log file
  api.registerHttpRoute({
    path: '/trace/api/logs/load',
    auth: 'gateway',
    match: 'exact',
    handler: async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost');
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path parameter' }));
        return true;
      }

      // Security: validate path is within log dir (realpath + symlink check)
      if (!logger.isPathWithinLogDir(filePath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path not allowed' }));
        return true;
      }

      const events = logger.loadFromFile(filePath);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ events }));
      return true;
    },
  });

  // GET /trace/api/sse — Server-Sent Events stream
  api.registerHttpRoute({
    path: '/trace/api/sse',
    auth: 'gateway',
    match: 'exact',
    handler: async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      logger.addSSEClient(res);

      req.on('close', () => {
        logger.removeSSEClient(res);
      });

      // Keep the connection open — return true but don't end the response
      return true;
    },
  });

  // GET /trace — Serve web viewer
  api.registerHttpRoute({
    path: '/trace',
    auth: 'gateway',
    match: 'prefix',
    handler: async (req, res) => {
      const { readFile } = await import('fs/promises');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const webDir = join(__dirname, '../../web/dist');
      
      let filePath = req.url?.replace('/trace', '') || '/index.html';
      if (filePath === '' || filePath === '/') filePath = '/index.html';
      
      const fullPath = join(webDir, filePath);
      
      try {
        const content = await readFile(fullPath);
        const ext = filePath.split('.').pop();
        const contentType = ext === 'js' ? 'application/javascript'
          : ext === 'css' ? 'text/css'
          : ext === 'html' ? 'text/html'
          : 'application/octet-stream';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return true;
    },
  });

  // =============================================================
  // Background Service — lifecycle management
  // =============================================================

  api.registerService({
    id: `${PLUGIN_PREFIX}-service`,
    start: () => {
      api.logger.info('[trace-viewer] Service started');
    },
    stop: () => {
      logger.stop();
      api.logger.info('[trace-viewer] Service stopped');
    },
  });
};

// =============================================================
// Helpers
// =============================================================

function truncateResult(content: unknown, logger: TraceLogger): unknown {
  if (typeof content === 'string') {
    return logger.truncate(content);
  }
  if (Array.isArray(content)) {
    return content.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        const block = item as { type?: string; text?: string };
        if (block.type === 'text' && block.text) {
          return { ...block, text: logger.truncate(block.text) };
        }
      }
      return item;
    });
  }
  // For objects/other types, stringify + truncate
  if (content !== null && content !== undefined) {
    const str = JSON.stringify(content);
    if (str.length > 5000) {
      return str.slice(0, 5000) + '... [truncated]';
    }
  }
  return content;
}
