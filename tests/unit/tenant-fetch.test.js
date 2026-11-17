// Painel: o seletor de tenant vale para todas as telas (header x-tenant-id nas
// rotas de gerenciamento por tenant; rotas do operador ficam sem header).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/store/tenantStore", () => {
  const state = { selectedTenantId: null };
  return { useTenantStore: { getState: () => state, __state: state } };
});

async function setup(tenantId) {
  const calls = [];
  global.window = { location: { origin: "http://painel" }, fetch: async (input, init) => { calls.push({ input, init }); return { ok: true }; } };
  global.Request = class {};
  const { useTenantStore } = await import("@/store/tenantStore");
  useTenantStore.__state.selectedTenantId = tenantId;
  const mod = await import("@/shared/utils/tenantFetch.js");
  mod.installTenantFetch();
  return { calls, mod };
}

describe("tenantFetch", () => {
  beforeEach(() => { vi.resetModules(); });

  it("manda o tenant no login OAuth e nas telas por tenant", async () => {
    const { calls } = await setup("platform");
    await window.fetch("/api/oauth/claude/exchange", { method: "POST", headers: { "Content-Type": "application/json" } });
    await window.fetch("/api/providers", { cache: "no-store" });
    await window.fetch("/api/keys");
    for (const c of calls) expect(new Headers(c.init.headers).get("x-tenant-id")).toBe("platform");
    expect(new Headers(calls[0].init.headers).get("content-type")).toBe("application/json");
  });

  it("nao mexe em rotas do operador nem em Global / All", async () => {
    const { calls } = await setup("platform");
    await window.fetch("/api/settings");
    await window.fetch("https://outro.site/api/providers");
    expect(calls.every((c) => !c.init || !new Headers(c.init.headers).has("x-tenant-id"))).toBe(true);
    vi.resetModules();
    const g = await setup(null);
    await window.fetch("/api/providers");
    expect(g.calls[0].init).toBeUndefined();
  });

  it("mesma lista de rotas que o backend aceita por tenant", async () => {
    const { mod } = await setup(null);
    expect(mod.isTenantScopedPath("/api/providers/abc")).toBe(true);
    expect(mod.isTenantScopedPath("/api/providers/abc/models")).toBe(true);
    expect(mod.isTenantScopedPath("/api/providers/client")).toBe(false);
    expect(mod.isTenantScopedPath("/api/usage/stats")).toBe(false);
    expect(mod.isTenantScopedPath("/api/tenants")).toBe(false);
  });
});
