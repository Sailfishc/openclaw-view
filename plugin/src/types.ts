// Plugin-specific types (OpenClaw API surface)
// These types approximate the OpenClaw plugin SDK interfaces.
// Replace with actual SDK imports when integrating.

export interface PluginApi {
  logger: PluginLogger;
  config: PluginConfig;
  registerHook(
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => void | Promise<void>,
    meta?: { name?: string; description?: string },
  ): void;
  on(
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any,
    opts?: { priority?: number },
  ): void;
  registerHttpRoute(route: HttpRouteConfig): void;
  registerService(service: ServiceConfig): void;
}

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface PluginConfig {
  logDir?: string;
  maxLogSize?: number;
  port?: number;
  truncateContentAt?: number;
}

export interface HttpRouteConfig {
  path: string;
  auth: 'plugin' | 'gateway';
  match?: 'exact' | 'prefix';
  replaceExisting?: boolean;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

export interface ServiceConfig {
  id: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
}

// Node.js HTTP types (simplified)
export interface IncomingMessage {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface ServerResponse {
  statusCode: number;
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(data?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}
