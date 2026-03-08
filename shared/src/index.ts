// ============================================================
// OpenClaw Trace Viewer — Shared Type Definitions
// ============================================================

// ------ Event Types ------

export type EventType =
  | 'message:received'
  | 'message:preprocessed'
  | 'message:sent'
  | 'prompt:build'
  | 'model:resolve'
  | 'tool_result:persist'
  | 'session:compact'
  | 'command'
  | 'agent:bootstrap'
  | 'gateway:startup';

// ------ Event Payloads ------

export interface MessageReceivedPayload {
  from: string;
  content: string;
  messageId?: string;
  metadata?: {
    to?: string;
    provider?: string;
    surface?: string;
    threadId?: string;
    senderId?: string;
    senderName?: string;
    senderUsername?: string;
  };
}

export interface MessagePreprocessedPayload {
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
}

export interface MessageSentPayload {
  to: string;
  content: string;
  success: boolean;
  error?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
}

export interface PromptBuildPayload {
  messageCount?: number;
  hasSystemPrompt?: boolean;
  prependContext?: string;
  appendSystemContext?: string;
  prependSystemContext?: string;
  lastUserMessage?: string;
  toolsCount?: number;
  toolNames?: string[];
}

export interface ModelResolvePayload {
  modelOverride?: string;
  providerOverride?: string;
}

export interface ToolResultPersistPayload {
  toolName?: string;
  toolUseId?: string;
  result?: unknown;
  isError?: boolean;
}

export interface SessionCompactPayload {
  phase: 'before' | 'after';
  messageCount?: number;
  tokenCount?: number;
  summary?: string;
}

export interface CommandPayload {
  action: string;
}

export interface BootstrapPayload {
  workspaceDir?: string;
}

export interface GatewayStartupPayload {
  timestamp: string;
}

export type EventPayload =
  | MessageReceivedPayload
  | MessagePreprocessedPayload
  | MessageSentPayload
  | PromptBuildPayload
  | ModelResolvePayload
  | ToolResultPersistPayload
  | SessionCompactPayload
  | CommandPayload
  | BootstrapPayload
  | GatewayStartupPayload;

// ------ Trace Event (Top-level log record) ------

export interface TraceEvent {
  timestamp: string;
  seq: number;
  eventType: EventType;
  sessionId?: string;
  channelId?: string;
  conversationId?: string;
  payload: EventPayload;
  duration?: number;
  project?: string;
}

// ------ Frontend-derived structures ------

export interface ConversationTurn {
  turnIndex: number;
  startTime: string;
  endTime?: string;
  events: TraceEvent[];
}

export interface TraceStats {
  totalEvents: number;
  messageCount: { received: number; sent: number };
  toolCallCount: number;
  toolUsageByName: Record<string, number>;
  modelUsage: Record<string, number>;
  compactionCount: number;
  commandCount: Record<string, number>;
  firstEventTime?: string;
  lastEventTime?: string;
}

// ------ SSE protocol ------

export type SSEMessageType = 'event' | 'full_reload' | 'heartbeat';

export interface SSEMessage {
  type: SSEMessageType;
  data: TraceEvent | TraceEvent[];
}

// ------ API response types ------

export interface EventsResponse {
  events: TraceEvent[];
  stats: TraceStats;
}
