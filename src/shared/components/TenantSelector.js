"use client";

import { useEffect, useState } from "react";
import { useTenantStore } from "@/store/tenantStore";

// Simple combo box + "new tenant" button, per explicit product decision:
// functionality over polish for the tenant switcher. Selection is global
// (Zustand + localStorage, see src/store/tenantStore.js) so any page can
// read it without prop drilling.
export default function TenantSelector() {
  const tenants = useTenantStore((s) => s.tenants);
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const fetchTenants = useTenantStore((s) => s.fetchTenants);
  const setSelectedTenantId = useTenantStore((s) => s.setSelectedTenantId);
  const createTenant = useTenantStore((s) => s.createTenant);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const current = tenants.find((t) => t.id === selectedTenantId);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  // Spec 11 §8.4: formulario no lugar do prompt() do navegador.
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const { error } = await createTenant(newName);
    setCreating(false);
    if (error) {
      alert(error);
      return;
    }
    setNewName("");
    setShowForm(false);
  };

  return (
    <div className="flex items-center gap-1">
      <div
        className={`flex h-8 items-center gap-1.5 rounded-lg border pl-2 pr-1 transition-colors ${
          selectedTenantId ? "border-primary/40 bg-primary/5" : "border-border bg-surface/60"
        }`}
      >
        <span className={`material-symbols-outlined text-[16px] ${selectedTenantId ? "text-primary" : "text-text-muted"}`}>
          {selectedTenantId ? "domain" : "public"}
        </span>
      <select
        value={selectedTenantId || ""}
        onChange={(e) => setSelectedTenantId(e.target.value || null)}
        className="h-7 bg-transparent pr-1 text-sm focus:outline-none max-w-[200px] truncate cursor-pointer"
        title="Every page shows only this tenant's connections, combos and keys"
      >
        <option value="">Global / All</option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      </div>
      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        disabled={creating}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface/60 text-text-muted hover:text-primary hover:border-primary/50 transition-colors"
        title="New tenant"
        aria-label="New tenant"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
      </button>
      {showForm && (
        <form onSubmit={handleCreate} className="flex items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tenant name"
            className="h-8 rounded-lg border border-border bg-surface/60 px-2 text-sm"
          />
          <button type="submit" disabled={creating} className="h-8 rounded-lg border border-border px-2 text-sm">
            Create
          </button>
        </form>
      )}
      <span className="ml-2 hidden xl:inline text-xs text-text-muted whitespace-nowrap">
        {current ? `Showing only ${current.name}` : "Showing all tenants"}
      </span>
    </div>
  );
}
