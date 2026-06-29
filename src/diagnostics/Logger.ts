import { Events } from "../core/Events";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  scope?: string;
  data?: unknown;
  timestamp: string;
}

export class Logger extends Events {
  private entries: LogEntry[] = [];

  log(level: LogLevel, message: string, data?: unknown, scope?: string): LogEntry {
    const entry: LogEntry = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${this.entries.length}`,
      level,
      message,
      scope,
      data,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    this.trigger("log", entry);
    return entry;
  }

  debug(message: string, data?: unknown, scope?: string): LogEntry { return this.log("debug", message, data, scope); }
  info(message: string, data?: unknown, scope?: string): LogEntry { return this.log("info", message, data, scope); }
  warn(message: string, data?: unknown, scope?: string): LogEntry { return this.log("warn", message, data, scope); }
  error(message: string, data?: unknown, scope?: string): LogEntry { return this.log("error", message, data, scope); }

  list(level?: LogLevel): readonly LogEntry[] {
    return level ? this.entries.filter((entry) => entry.level === level) : [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.trigger("clear");
  }
}
