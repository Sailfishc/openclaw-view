// ============================================================
// OpenClaw Trace Viewer Plugin — Entry Point
// ============================================================
//
// Registers hooks to intercept execution events and exposes
// HTTP routes for the viewer UI and API.
//
// Hook coverage:
//   [必须] message:received, message:preprocessed, message:sent
//   [必须] before_prompt_build, before_model_resolve
//   [必须] tool_result_persist
//   [推荐] session:compact:before/after, command:new/reset/stop
//   [可选] agent:bootstrap, gateway:startup
// ============================================================

import { TraceLogger } from './trace-logger.js';
import type { PluginApi, PluginConfig } from './types.js';
import type {
  MessageReceivedPayload,
  MessagePreprocessedPayload,
  MessageSentPayload,
  PromptBuildPayload,
  ModelResolvePayload,
  ToolResultPersistPayload,
  EventsResponse,
} from '@openclaw-view/shared';

const PLUGIN_PREFIX = 'trace-viewer';

export default (api: PluginApi) => {
  const config: PluginConfig = (api.config ?? {}) as PluginConfig;
  const logger = new TraceLogger(config, api.logger);

  // Initialize on startup
  logger.init();

  api.logger.info('[trace-viewer] Plugin loaded');

  // =============================================================
  // Event Hooks — Message Lifecycle
  // =============================================================

  api.registerHook(
    'message:received',
    async (_event: unknown, ctx: Record<string, unknown>) => {
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
    },
    { name: `${PLUGIN_PREFIX}.message-received`, description: 'Record inbound messages' },
  );

  api.registerHook(
    'message:preprocessed',
    async (_event: unknown, ctx: Record<string, unknown>) => {
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

  api.registerHook(
    'message:sent',
    async (_event: unknown, ctx: Record<string, unknown>) => {
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
    },
    { name: `${PLUGIN_PREFIX}.message-sent`, description: 'Record outbound messages' },
  );

  // =============================================================
  // Agent Lifecycle Hooks
  // =============================================================

  api.on(
    'before_prompt_build',
    (event: Record<string, unknown>, ctx: Record<string, unknown>) => {
      const messages = ctx.messages as unknown[] | undefined;
      const tools = ctx.tools as Array<{ name: string }> | undefined;

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
        hasSystemPrompt: event.systemPrompt !== undefined,
        prependContext: logger.truncate(event.prependContext as string | undefined),
        appendSystemContext: logger.truncate(event.appendSystemContext as string | undefined),
        prependSystemContext: logger.truncate(event.prependSystemContext as string | undefined),
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
    (event: Record<string, unknown>) => {
      const payload: ModelResolvePayload = {
        modelOverride: event.modelOverride as string | undefined,
        providerOverride: event.providerOverride as string | undefined,
      };
      logger.record({ eventType: 'model:resolve', payload });
      return {};
    },
    { priority: -100 },
  );

  // =============================================================
  // Tool Result Hook
  // =============================================================

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
      // Return undefined — don't modify the tool result
      return undefined;
    },
    { name: `${PLUGIN_PREFIX}.tool-result`, description: 'Record tool results' },
  );

  // =============================================================
  // Session Events
  // =============================================================

  api.registerHook(
    'session:compact:before',
    async (_event: unknown, ctx: Record<string, unknown>) => {
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
    async (_event: unknown, ctx: Record<string, unknown>) => {
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
    async (_event: unknown, ctx: Record<string, unknown>) => {
      logger.record({
        eventType: 'agent:bootstrap',
        payload: { workspaceDir: ctx.workspaceDir as string | undefined },
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
    auth: 'plugin',
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
    auth: 'plugin',
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
    auth: 'plugin',
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
    auth: 'plugin',
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
    auth: 'plugin',
    match: 'exact',
    handler: async (req, res) => {
      const url = new URL(req.url || '', 'http://localhost');
      const filePath = url.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path parameter' }));
        return true;
      }

      // Security: only allow loading files from within our log directory
      if (!filePath.startsWith(logger.getLogDir())) {
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
    auth: 'plugin',
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
