import { Events } from "../../core/Events";

export interface ErrorReport {
  id: string;
  source: string;
  message: string;
  stack?: string;
  cause?: unknown;
  timestamp: string;
  recoverable: boolean;
}

export class ErrorReporter extends Events {
  private reports: ErrorReport[] = [];

  report(source: string, error: unknown, recoverable = true): ErrorReport {
    const err = normalizeError(error);
    const report: ErrorReport = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${this.reports.length}`,
      source,
      message: err.message,
      stack: err.stack,
      cause: error,
      timestamp: new Date().toISOString(),
      recoverable,
    };
    this.reports.push(report);
    this.trigger("error", report);
    return report;
  }

  list(): readonly ErrorReport[] {
    return [...this.reports];
  }

  clear(): void {
    this.reports = [];
    this.trigger("clear");
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : JSON.stringify(error));
}
