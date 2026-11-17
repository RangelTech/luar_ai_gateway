"use client";

import { useTenantStore } from "@/store/tenantStore";

// Aviso nos modais de conexao: em qual tenant a credencial vai ser salva.
// Com MT_STRICT=1 o backend recusa conexao sem dono, entao "Global / All"
// precisa ser trocado no seletor do topo antes de conectar.
export default function TenantScopeNotice() {
  const tenants = useTenantStore((s) => s.tenants);
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const current = tenants.find((t) => t.id === selectedTenantId);

  if (!selectedTenantId) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
        <span className="material-symbols-outlined text-[18px] leading-5">domain_disabled</span>
        <span>
          No tenant selected. Choose a tenant in the selector at the top of the page before connecting —
          every connection must belong to one tenant.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <span className="material-symbols-outlined text-[18px] text-primary">domain</span>
      <span className="text-text-muted">Saving to tenant</span>
      <span className="font-medium truncate">{current ? current.name : selectedTenantId}</span>
    </div>
  );
}
