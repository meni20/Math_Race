import type { TeacherCreateRoomRequest } from "../_shared/contracts.ts";
import { createAdminClient } from "../_shared/admin.ts";
import { teacherCreateRoom } from "../_shared/game-core.ts";
import { buildError, corsHeaders, jsonResponse, readJsonRequest } from "../_shared/http.ts";
import { normalizeRoomId } from "../_shared/input.ts";
import { runRoomMutation } from "../_shared/room-store.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object");
}

function errorField(error: unknown, field: string) {
  if (!isRecord(error)) {
    return "";
  }
  const value = error[field];
  return typeof value === "string" ? value : "";
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message || "Teacher create room failed.";
  }
  const message = errorField(error, "message");
  if (message) {
    return message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Teacher create room failed with a non-Error exception.";
}

function findMissingColumn(error: unknown) {
  const text = [
    errorField(error, "message"),
    errorField(error, "details"),
    errorField(error, "hint"),
    errorField(error, "code")
  ].filter(Boolean).join(" ");
  const quotedColumn = text.match(/'([^']+)' column/i)?.[1];
  if (quotedColumn) {
    return quotedColumn;
  }
  return text.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+does not exist/i)?.[1] ?? undefined;
}

function isDevelopmentResponse() {
  const environment = Deno.env.get("ENVIRONMENT") ?? Deno.env.get("DENO_ENV") ?? "";
  return environment.toLowerCase() !== "production";
}

function normalizeDifficulty(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return normalized === "EASY" || normalized === "MEDIUM" || normalized === "HARD" ? normalized : "MEDIUM";
}

function normalizeMapId(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "sunny-forest" || normalized === "snow-peak" || normalized === "fun-world" || normalized === "grand-prix") {
    return normalized === "grand-prix" ? "grand_prix" : normalized;
  }
  if (raw === "grand_prix") {
    return raw;
  }
  return "sunny-forest";
}

function normalizeTargetScore(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? Math.max(100, Math.min(5000, Math.trunc(numberValue)))
    : 500;
}

function normalizeRoomSettings(payload: TeacherCreateRoomRequest) {
  const rawSettings = isRecord(payload.roomSettings) ? payload.roomSettings : {};
  const difficulty = normalizeDifficulty(rawSettings.difficulty ?? payload.difficulty);
  const mapId = normalizeMapId(rawSettings.mapId ?? payload.mapId);
  return {
    raceName: typeof rawSettings.raceName === "string" && rawSettings.raceName.trim()
      ? rawSettings.raceName.trim()
      : "Classroom Math Race",
    classGroup: typeof rawSettings.classGroup === "string" && rawSettings.classGroup.trim()
      ? rawSettings.classGroup.trim()
      : typeof payload.className === "string"
        ? payload.className.trim()
        : "",
    difficulty,
    mapId,
    targetScore: normalizeTargetScore(rawSettings.targetScore),
    maxPlayers: 8,
    operations: "MIXED" as const,
    questionTimeLimitSeconds: 15,
    raceDurationSeconds: 180
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: buildError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.") }, 405);
  }

  try {
    const payload = await readJsonRequest<TeacherCreateRoomRequest>(request);
    const roomSettings = normalizeRoomSettings(payload);
    const normalizedPayload: TeacherCreateRoomRequest = {
      roomId: normalizeRoomId(payload.roomId, false),
      teacherSessionId: String(payload.teacherSessionId ?? ""),
      roomSettings,
      className: roomSettings.classGroup || (typeof payload.className === "string" ? payload.className : undefined),
      difficulty: roomSettings.difficulty,
      mapId: roomSettings.mapId,
      questionTypes: ["MIXED"],
      requiresApproval: false
    };
    const now = Date.now();
    const admin = createAdminClient();
    const result = await runRoomMutation(
      admin,
      normalizedPayload.roomId,
      now,
      (room, presenceByPlayerId) => teacherCreateRoom(room, normalizedPayload, presenceByPlayerId, now)
    );
    return jsonResponse(result.response);
  } catch (error) {
    const message = safeErrorMessage(error);
    const missingColumn = findMissingColumn(error);
    console.error("[teacher-create-room]", {
      operation: "teacher-create-room",
      message,
      missingColumn,
      code: errorField(error, "code"),
      details: errorField(error, "details"),
      hint: errorField(error, "hint")
    });
    const responseError = {
      ...buildError("TEACHER_CREATE_FAILED", message),
      operation: "teacher-create-room",
      missingFieldOrColumn: missingColumn,
      validationIssue: message.includes("Missing required id") ? "roomId is required." : undefined,
      originalMessage: isDevelopmentResponse() ? message : undefined,
      originalCode: isDevelopmentResponse() ? errorField(error, "code") || undefined : undefined,
      details: isDevelopmentResponse() ? errorField(error, "details") || undefined : undefined,
      hint: isDevelopmentResponse() ? errorField(error, "hint") || undefined : undefined
    };
    return jsonResponse({ error: responseError }, 400);
  }
});
