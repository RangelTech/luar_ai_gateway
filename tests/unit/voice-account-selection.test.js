import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connections: vi.fn(), settings: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: db.connections, getSettings: db.settings,
  updateProviderConnection: db.update, getProxyPools: vi.fn(), validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}), pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {}, resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

import { getProviderCredentials } from "@/sse/services/auth.js";

beforeEach(() => {
  vi.clearAllMocks();
  db.settings.mockResolvedValue({});
  db.update.mockResolvedValue(undefined);
  db.connections.mockResolvedValue([
    { id: "outlook", accessToken: "o", lastUsedAt: "2026-11-01T00:00:00Z" },
    { id: "work", accessToken: "w", lastUsedAt: "2026-11-02T00:00:00Z" },
    { id: "key-only", apiKey: "k" },
  ]);
});

describe("voice account selection", () => {
  it("balances concurrent sessions and permits reuse of an occupied account", async () => {
    const options = { tenantId: "tenant-a", voiceLoads: { outlook: 1, work: 0 } };
    const first = await getProviderCredentials("claude", null, null, options);
    expect(first.connectionId).toBe("work");
    const second = await getProviderCredentials("claude", null, null,
      { ...options, voiceLoads: { outlook: 1, work: 1 } });
    expect(second.connectionId).toBe("outlook");
    expect(db.connections).toHaveBeenCalledWith({ provider: "claude", isActive: true, tenantId: "tenant-a" });
  });

  it("fails closed when a requested account is absent or not OAuth", async () => {
    const options = { tenantId: "tenant-a", voiceLoads: {}, requirePreferredConnection: true };
    expect(await getProviderCredentials("claude", null, null,
      { ...options, preferredConnectionId: "missing" })).toBeNull();
    expect(await getProviderCredentials("claude", null, null,
      { ...options, preferredConnectionId: "key-only" })).toBeNull();
  });
});
