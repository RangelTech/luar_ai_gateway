import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  key: vi.fn(), select: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/sse/services/auth.js", () => ({
  getApiKeyAuth: mocks.key,
  getProviderCredentials: mocks.select,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.refresh,
}));

import { POST } from "../../src/app/api/v1/voice/internal/prepare/route.js";

function request(secret = "internal", key = "client-key", body = {}) {
  return new Request("http://localhost/api/v1/voice/internal/prepare", {
    method: "POST",
    headers: { "x-9r-voice-internal-secret": secret,
               Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NINEROUTER_VOICE_INTERNAL_SECRET = "internal";
  process.env.MT_STRICT = "1";
  mocks.key.mockReset().mockResolvedValue({ isActive: true, tenantId: "tenant-001",
                                           tenantStatus: "active", allowedCombos: null });
  mocks.select.mockReset().mockResolvedValue({ connectionId: "outlook", accessToken: "old",
                                              connectionName: "Outlook" });
  mocks.refresh.mockReset().mockResolvedValue({ accessToken: "new-oauth-token" });
});
afterEach(() => {
  delete process.env.NINEROUTER_VOICE_INTERNAL_SECRET;
  delete process.env.MT_STRICT;
});

describe("internal voice admission", () => {
  it("rejects external access and invalid or unscoped client keys", async () => {
    expect((await POST(request("wrong"))).status).toBe(404);
    expect(mocks.key).not.toHaveBeenCalled();
    mocks.key.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.key.mockResolvedValueOnce({ isActive: true, tenantId: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("selects a tenant account with load and refreshes OAuth before returning it", async () => {
    const response = await POST(request("internal", "client-key", {
      voiceLoads: { outlook: 2, quality: 1 }, connectionId: "outlook",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.select).toHaveBeenCalledWith("claude", new Set(), null,
      expect.objectContaining({ tenantId: "tenant-001", preferredConnectionId: "outlook",
                                requirePreferredConnection: true,
                                voiceLoads: { outlook: 2, quality: 1 } }));
    expect(mocks.refresh).toHaveBeenCalledWith("claude", expect.objectContaining({ connectionId: "outlook" }));
    expect(await response.json()).toMatchObject({ connectionId: "outlook", accessToken: "new-oauth-token" });
  });
});
