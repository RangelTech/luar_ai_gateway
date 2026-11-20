import crypto from "node:crypto";
import { getApiKeyAuth, getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";

export const runtime = "nodejs";

function authorizedInternal(request) {
  const expected = process.env.NINEROUTER_VOICE_INTERNAL_SECRET;
  const received = request.headers.get("x-9r-voice-internal-secret") || "";
  if (!expected || !received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export async function POST(request) {
  if (!authorizedInternal(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const bearer = request.headers.get("authorization") || "";
  const apiKey = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  const keyAuth = apiKey ? await getApiKeyAuth(apiKey) : null;
  if (!keyAuth?.isActive) return Response.json({ error: "Invalid API key" }, { status: 401 });
  if (!keyAuth.tenantId && process.env.MT_STRICT === "1") {
    return Response.json({ error: "Tenant-bound key required" }, { status: 403 });
  }
  if (keyAuth.tenantStatus && keyAuth.tenantStatus !== "active") {
    return Response.json({ error: "Tenant unavailable" }, { status: 403 });
  }
  if (Array.isArray(keyAuth.allowedCombos)) {
    return Response.json({ error: "Voice requires an unrestricted API key" }, { status: 403 });
  }
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const pinned = typeof body.connectionId === "string" && body.connectionId ? body.connectionId : null;
  const excluded = Array.isArray(body.excludeIds) ? body.excludeIds.filter((id) => typeof id === "string").slice(0, 20) : [];
  const loads = body.voiceLoads && typeof body.voiceLoads === "object" && !Array.isArray(body.voiceLoads)
    ? body.voiceLoads : {};
  const credentials = await getProviderCredentials("claude", new Set(excluded), null, {
    tenantId: keyAuth.tenantId ?? null,
    preferredConnectionId: pinned,
    requirePreferredConnection: !!pinned,
    voiceLoads: loads,
  });
  if (!credentials || credentials.allRateLimited) {
    return Response.json({ error: "No eligible Claude account" }, { status: 503 });
  }
  const refreshed = await checkAndRefreshToken("claude", credentials);
  if (!refreshed?.accessToken) {
    return Response.json({ error: "Claude account needs authentication" }, { status: 503 });
  }
  return Response.json({ connectionId: credentials.connectionId,
                         accountName: credentials.connectionName,
                         accessToken: refreshed.accessToken },
                       { headers: { "Cache-Control": "no-store" } });
}
