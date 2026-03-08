import {
  appendFileSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { join, basename, relative } from 'node:path';
import { homedir } from 'node:os';
import type { TraceEvent, EventType, EventPayload, TraceStats } from '@openclaw-view/shared';
import type { PluginConfig, PluginLogger, ServerResponse } from './types.js';

const RECORD_SEPARATOR = '\n---\n';
const DEFAULT_LOG_DIR = join(homedir(), '.openclaw', 'trace-viewer');
const DEFAULT_TRUNCATE_AT = 5000;

export class TraceLogger {
  private logDir: string;
  private logFile = '';
  private projectName = '';
  private projectDir = '';
  private maxLogSize: number;
  private truncateAt: number;
  private seq = 0;
  private sseClients: Set<ServerResponse> = new Set();
  private logger: PluginLogger;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cachedStats: TraceStats | null = null;
  private statsCacheSeq = -1;

  constructor(config: PluginConfig, logger: PluginLogger) {
    this.logDir = config.logDir || DEFAULT_LOG_DIR;
    this.maxLogSize = (config.maxLogSize || 300) * 1024 * 1024;
    this.truncateAt = config.truncateContentAt || DEFAULT_TRUNCATE_AT;
    this.logger = logger;

    // Ensure base log directory exists
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch { /* ignore */ }
  }

  // ------ Initialization ------

  /**
   * Initialize logging for a project.
   * Accepts a fixed project name (preferred) or a directory path
   * whose basename will be used. Falls back to 'trace-viewer'.
   */
  init(projectNameOrPath?: string): void {
    if (projectNameOrPath && !projectNameOrPath.includes('/') && !projectNameOrPath.includes('\\')) {
      // Treat as a direct project name (no path separators)
      this.projectName = projectNameOrPath.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    } else {
      const cwd = projectNameOrPath || 'trace-viewer';
      this.projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-.]/g, '_');
    }
    this.projectDir = join(this.logDir, this.projectName);

    try {
      mkdirSync(this.projectDir, { recursive: true });
    } catch { /* ignore */ }

    // Try to resume a recent log file (modified within 1 hour)
    const recentLog = this.findRecentLog();
    if (recentLog) {
      this.logFile = recentLog;
      this.logger.info(`[trace-viewer] Resuming log: ${basename(recentLog)}`);
    } else {
      this.logFile = this.generateNewLogPath();
      this.logger.info(`[trace-viewer] New log: ${basename(this.logFile)}`);
    }

    // Reset sequence counter
    this.seq = this.countExistingRecords();


  }

  // ------ Record Writing ------

  /**
   * Record a trace event. This is the primary API for hooks.
   */
  record(params: {
    eventType: EventType;
    payload: EventPayload;
    sessionId?: string;
    channelId?: string;
    conversationId?: string;
    duration?: number;
  }): void {
    if (!this.logFile) {
      this.init();
    }

    const event: TraceEvent = {
      timestamp: new Date().toISOString(),
      seq: this.seq++,
      eventType: params.eventType,
      payload: params.payload,
      project: this.projectName,
      ...(params.sessionId && { sessionId: params.sessionId }),
      ...(params.channelId && { channelId: params.channelId }),
      ...(params.conversationId && { conversationId: params.conversationId }),
      ...(params.duration !== undefined && { duration: params.duration }),
    };

    // Write to file
    this.appendRecord(event);

    // Push to SSE clients
    this.pushToSSEClients(event);
  }

  // ------ Log File Management ------

  private appendRecord(event: TraceEvent): void {
    // Check rotation before writing
    this.checkAndRotate();

    try {
      // Use compact JSON (no pretty-print) to reduce file I/O
      appendFileSync(
        this.logFile,
        JSON.stringify(event) + RECORD_SEPARATOR,
      );
    } catch (err) {
      this.logger.error(`[trace-viewer] Failed to write log: ${err}`);
    }
  }

  private checkAndRotate(): void {
    try {
      if (!existsSync(this.logFile)) return;
      const size = statSync(this.logFile).size;
      if (size >= this.maxLogSize) {
        this.logFile = this.generateNewLogPath();
        this.logger.info(`[trace-viewer] Rotated to: ${basename(this.logFile)}`);
      }
    } catch { /* ignore */ }
  }

  private generateNewLogPath(): string {
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    return join(this.projectDir, `${this.projectName}_${ts}.jsonl`);
  }

  private findRecentLog(): string | null {
    try {
      const files = readdirSync(this.projectDir)
        .filter(
          (f) =>
            f.startsWith(this.projectName + '_') && f.endsWith('.jsonl'),
        )
        .sort()
        .reverse();

      if (files.length === 0) return null;

      const latest = join(this.projectDir, files[0]);
      const stats = statSync(latest);
      const oneHour = 60 * 60 * 1000;
      if (Date.now() - stats.mtime.getTime() < oneHour) {
        return latest;
      }
    } catch { /* ignore */ }
    return null;
  }

  private countExistingRecords(): number {
    try {
      if (!existsSync(this.logFile)) return 0;
      const content = readFileSync(this.logFile, 'utf-8');
      return content.split(RECORD_SEPARATOR).filter((p) => p.trim()).length;
    } catch {
      return 0;
    }
  }

  // ------ Reading ------

  /**
   * Parse all events from the current log file.
   */
  getEvents(): TraceEvent[] {
    try {
      if (!this.logFile || !existsSync(this.logFile)) return [];
      const content = readFileSync(this.logFile, 'utf-8');
      return content
        .split(RECORD_SEPARATOR)
        .filter((p) => p.trim())
        .map((p) => {
          try {
            return JSON.parse(p) as TraceEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is TraceEvent => e !== null);
    } catch {
      return [];
    }
  }

  /**
   * Get events after a given sequence number (for incremental loading).
   */
  getEventsSince(sinceSeq: number): TraceEvent[] {
    return this.getEvents().filter((e) => e.seq > sinceSeq);
  }

  /**
   * Compute statistics from current events.
   * Results are cached until a new event is recorded.
   */
  computeStats(): TraceStats {
    if (this.cachedStats && this.statsCacheSeq === this.seq) {
      return this.cachedStats;
    }
    const events = this.getEvents();
    const stats: TraceStats = {
      totalEvents: events.length,
      messageCount: { received: 0, sent: 0 },
      toolCallCount: 0,
      toolUsageByName: {},
      modelUsage: {},
      compactionCount: 0,
      commandCount: {},
    };

    for (const event of events) {
      switch (event.eventType) {
        case 'message:received':
          stats.messageCount.received++;
          break;
        case 'message:sent':
          stats.messageCount.sent++;
          break;
        case 'tool_result:persist': {
          stats.toolCallCount++;
          const toolPayload = event.payload as { toolName?: string };
          if (toolPayload.toolName) {
            stats.toolUsageByName[toolPayload.toolName] =
              (stats.toolUsageByName[toolPayload.toolName] || 0) + 1;
          }
          break;
        }
        case 'model:resolve': {
          const modelPayload = event.payload as { modelOverride?: string };
          const model = modelPayload.modelOverride || 'default';
          stats.modelUsage[model] = (stats.modelUsage[model] || 0) + 1;
          break;
        }
        case 'session:compact':
          stats.compactionCount++;
          break;
        case 'command': {
          const cmdPayload = event.payload as { action: string };
          stats.commandCount[cmdPayload.action] =
            (stats.commandCount[cmdPayload.action] || 0) + 1;
          break;
        }
      }

      // Track time range
      if (!stats.firstEventTime || event.timestamp < stats.firstEventTime) {
        stats.firstEventTime = event.timestamp;
      }
      if (!stats.lastEventTime || event.timestamp > stats.lastEventTime) {
        stats.lastEventTime = event.timestamp;
      }
    }

    this.cachedStats = stats;
    this.statsCacheSeq = this.seq;
    return stats;
  }

  // ------ Log File Listing ------

  /**
   * List all available log files grouped by project.
   */
  listLogFiles(): Array<{
    project: string;
    files: Array<{ name: string; path: string; size: number; mtime: string }>;
  }> {
    const result: Array<{
      project: string;
      files: Array<{ name: string; path: string; size: number; mtime: string }>;
    }> = [];

    try {
      const projects = readdirSync(this.logDir).filter((d) => {
        try {
          return statSync(join(this.logDir, d)).isDirectory();
        } catch {
          return false;
        }
      });

      for (const project of projects) {
        const dir = join(this.logDir, project);
        const files = readdirSync(dir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => {
            const fullPath = join(dir, f);
            const s = statSync(fullPath);
            return {
              name: f,
              path: fullPath,
              size: s.size,
              mtime: s.mtime.toISOString(),
            };
          })
          .sort((a, b) => b.mtime.localeCompare(a.mtime));

        if (files.length > 0) {
          result.push({ project, files });
        }
      }
    } catch { /* ignore */ }

    return result;
  }

  /**
   * Load events from a specific log file.
   */
  loadFromFile(filePath: string): TraceEvent[] {
    try {
      if (!existsSync(filePath)) return [];
      const content = readFileSync(filePath, 'utf-8');
      return content
        .split(RECORD_SEPARATOR)
        .filter((p) => p.trim())
        .map((p) => {
          try {
            return JSON.parse(p) as TraceEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is TraceEvent => e !== null);
    } catch {
      return [];
    }
  }

  // ------ SSE ------

  addSSEClient(res: ServerResponse): void {
    this.sseClients.add(res);
    this.logger.debug(`[trace-viewer] SSE client connected (total: ${this.sseClients.size})`);

    // Start heartbeat if first client
    if (this.sseClients.size === 1 && !this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.broadcastSSE({ type: 'heartbeat', data: [] as unknown as TraceEvent[] });
      }, 30_000);
    }

    // Send full reload to new client
    const events = this.getEvents();
    this.sendSSE(res, { type: 'full_reload', data: events });
  }

  removeSSEClient(res: ServerResponse): void {
    this.sseClients.delete(res);
    this.logger.debug(`[trace-viewer] SSE client disconnected (total: ${this.sseClients.size})`);

    // Stop heartbeat if no clients
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private pushToSSEClients(event: TraceEvent): void {
    if (this.sseClients.size === 0) return;
    this.broadcastSSE({ type: 'event', data: event });
  }

  private broadcastSSE(message: { type: string; data: unknown }): void {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private sendSSE(
    res: ServerResponse,
    message: { type: string; data: unknown },
  ): void {
    try {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch { /* ignore */ }
  }

  // ------ Cleanup ------

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch { /* ignore */ }
    }
    this.sseClients.clear();
  }

  // ------ Helpers ------

  /**
   * Truncate a string to the configured max length.
   */
  truncate(text: string | undefined): string | undefined {
    if (!text) return text;
    if (text.length <= this.truncateAt) return text;
    return text.slice(0, this.truncateAt) + `... [truncated at ${this.truncateAt} chars]`;
  }

  getLogFile(): string {
    return this.logFile;
  }

  getLogDir(): string {
    return this.logDir;
  }

  /**
   * Validate that a file path is safely within the log directory.
   * Uses realpath to prevent symlink traversal attacks.
   */
  isPathWithinLogDir(filePath: string): boolean {
    try {
      // Reject symlinks
      const lstats = lstatSync(filePath);
      if (lstats.isSymbolicLink()) return false;

      // Resolve real paths and check containment
      const realBase = realpathSync(this.logDir);
      const realTarget = realpathSync(filePath);
      const rel = relative(realBase, realTarget);
      // Must not escape the base directory
      return !rel.startsWith('..') && !rel.startsWith('/');
    } catch {
      return false;
    }
  }

  /**
   * Re-initialize with a workspace directory once agent:bootstrap fires.
   * This updates the project name to match the actual workspace.
   */
  reinitWithWorkspace(workspaceDir: string): void {
    const newName = basename(workspaceDir).replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (newName && newName !== this.projectName) {
      this.logger.info(`[trace-viewer] Switching project: ${this.projectName} → ${newName}`);
      this.init(workspaceDir);
    }
  }
}
