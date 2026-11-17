"use client";

// Escopo de tenant em todas as telas do painel.
//
// O seletor do topo (src/store/tenantStore.js) guarda o tenant escolhido. Antes
// disso cada tela precisava lembrar de mandar ?tenantId=..., e varias nao
// mandavam (detalhe do provedor, chaves, modal de OAuth): a tela mostrava as
// conexoes de todos os tenants e o login OAuth falhava com MT_STRICT=1.
//
// Aqui o fetch do navegador ganha o header x-tenant-id nas rotas da API de
// gerenciamento que sao por tenant. A lista e a mesma que o backend aceita do
// token de servico (src/dashboardGuard.js, SERVICE_TENANT_PATHS); rotas do
// operador (settings, proxy-pools, usage global...) seguem sem header.
// "Global / All" (nenhum tenant) nao manda header: visao de operador, igual antes.

import { useTenantStore } from "@/store/tenantStore";

const TENANT_PATHS = [
  /^\/api\/providers$/, /^\/api\/providers\/validate$/,
  /^\/api\/providers\/(?!client$|test-batch$|suggested-models$)[^/]+$/, /^\/api\/providers\/[^/]+\/(test|models)$/,
  /^\/api\/models\/custom$/,
  /^\/api\/combos(\/[^/]+)?$/, /^\/api\/keys(\/[^/]+)?$/,
  /^\/api\/provider-nodes(\/validate|\/[^/]+)?$/,
  /^\/api\/oauth\/.+/,
  /^\/api\/usage\/(?!chart$|history$|logs$|providers$|request-details$|request-logs$|stats$|stream$)[^/]+$/,
];

export function isTenantScopedPath(pathname) {
  return TENANT_PATHS.some((re) => re.test(pathname));
}

function pathnameOf(input) {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    if (!raw) return null;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function installTenantFetch() {
  if (typeof window === "undefined" || window.__tenantFetchInstalled) return;
  window.__tenantFetchInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const tenantId = useTenantStore.getState().selectedTenantId;
    const pathname = tenantId ? pathnameOf(input) : null;
    if (!pathname || !isTenantScopedPath(pathname)) return original(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("x-tenant-id")) headers.set("x-tenant-id", tenantId);
    return original(input, { ...(init || {}), headers });
  };
}
