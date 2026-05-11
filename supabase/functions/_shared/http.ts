import type { GameErrorMessage } from "./contracts.ts";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

export function buildError(code: string, message: string, roomId?: string, playerId?: string): GameErrorMessage {
  return {
    code,
    message,
    roomId,
    playerId
  };
}

export async function readJsonRequest<T>(request: Request): Promise<T> {
  return await request.json() as T;
}
