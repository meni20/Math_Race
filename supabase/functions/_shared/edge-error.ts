type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object");
}

export function errorField(error: unknown, field: string) {
  if (!isRecord(error)) {
    return "";
  }
  const value = error[field];
  return typeof value === "string" ? value : "";
}

export function safeErrorMessage(error: unknown, fallback = "Request failed with a non-Error exception.") {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  const message = errorField(error, "message");
  if (message) {
    return message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

export function findMissingColumn(error: unknown) {
  const text = [
    errorField(error, "message"),
    errorField(error, "details"),
    errorField(error, "hint"),
    errorField(error, "code")
  ].filter(Boolean).join(" ");
  return text.match(/'([^']+)' column/i)?.[1]
    ?? text.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i)?.[1]
    ?? undefined;
}

export function isDevelopmentResponse() {
  const environment = Deno.env.get("ENVIRONMENT") ?? Deno.env.get("DENO_ENV") ?? "";
  return environment.toLowerCase() !== "production";
}

export function buildDiagnosticError(base: { code: string; message: string; roomId?: string; playerId?: string }, operation: string, error: unknown) {
  return {
    ...base,
    operation,
    missingFieldOrColumn: findMissingColumn(error),
    validationIssue: base.message.includes("Missing required id")
      ? "roomId/roomCode and playerId/session identity are required."
      : undefined,
    originalMessage: isDevelopmentResponse() ? safeErrorMessage(error, base.message) : undefined,
    originalCode: isDevelopmentResponse() ? errorField(error, "code") || undefined : undefined,
    details: isDevelopmentResponse() ? errorField(error, "details") || undefined : undefined,
    hint: isDevelopmentResponse() ? errorField(error, "hint") || undefined : undefined
  };
}

export function logEdgeError(operation: string, error: unknown, context: Record<string, unknown> = {}) {
  console.error(`[${operation}]`, {
    operation,
    message: safeErrorMessage(error),
    missingColumn: findMissingColumn(error),
    code: errorField(error, "code"),
    details: errorField(error, "details"),
    hint: errorField(error, "hint"),
    ...context
  });
}
