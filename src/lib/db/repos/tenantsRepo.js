import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToTenant(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    rpm: row.rpm ?? null,
    status: row.status || "active",
    createdAt: row.createdAt,
  };
}

export async function getTenants() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM tenants ORDER BY createdAt ASC`);
  return rows.map(rowToTenant);
}

export async function getTenantById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM tenants WHERE id = ?`, [id]);
  return rowToTenant(row);
}

export async function createTenant(name, opts = {}) {
  if (!name) throw new Error("name is required");
  const db = await getAdapter();
  const tenant = {
    id: opts.id || uuidv4(),
    name,
    rpm: opts.rpm ?? null,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO tenants(id, name, rpm, status, createdAt) VALUES(?, ?, ?, ?, ?)`,
    [tenant.id, tenant.name, tenant.rpm, tenant.status, tenant.createdAt]
  );
  return tenant;
}

export async function updateTenant(id, data) {
  const db = await getAdapter();
  const cur = db.get(`SELECT * FROM tenants WHERE id = ?`, [id]);
  if (!cur) return null;
  const name = data.name ?? cur.name;
  const rpm = data.rpm === undefined ? cur.rpm : data.rpm;
  const status = data.status ?? (cur.status || "active");
  db.run(`UPDATE tenants SET name = ?, rpm = ?, status = ? WHERE id = ?`, [name, rpm, status, id]);
  return rowToTenant(db.get(`SELECT * FROM tenants WHERE id = ?`, [id]));
}

// Offboarding: remove o tenant e TUDO que e dele (chaves, conexoes, combos).
export async function deleteTenantCascade(id, { purgeUsage = false } = {}) {
  const db = await getAdapter();
  let counts = null;
  db.transaction(() => {
    const k = db.run(`DELETE FROM apiKeys WHERE tenantId = ?`, [id]);
    const c = db.run(`DELETE FROM providerConnections WHERE tenantId = ?`, [id]);
    const b = db.run(`DELETE FROM combos WHERE tenantId = ?`, [id]);
    const n = db.run(`DELETE FROM providerNodes WHERE tenantId = ?`, [id]);
    const u = purgeUsage ? db.run(`DELETE FROM usageHistory WHERE tenantId = ?`, [id]) : null;
    const t = db.run(`DELETE FROM tenants WHERE id = ?`, [id]);
    counts = { usage: u?.changes ?? 0, keys: k?.changes ?? 0, connections: c?.changes ?? 0, combos: b?.changes ?? 0, nodes: n?.changes ?? 0, tenant: t?.changes ?? 0 };
  });
  return counts;
}

// Uso agregado do tenant (usageHistory.tenantId, preenchido na gravacao e pela migracao 003).
// opts: sinceIso, untilIso. Retorna totais + quebra por provedor, modelo real,
// combo pedido, dia e hora (UTC). A hora fica no próprio agregado tenant-scoped;
// o painel LUAR não precisa pedir logs ou dados de outra empresa para desenhar
// o gráfico de atividade.
export async function getTenantUsage(id, { sinceIso = null, untilIso = null } = {}) {
  const db = await getAdapter();
  const params = [id];
  let where = `uh.tenantId = ?`;
  if (sinceIso) { where += ` AND uh.timestamp >= ?`; params.push(sinceIso); }
  if (untilIso) { where += ` AND uh.timestamp < ?`; params.push(untilIso); }
  const sums = `COUNT(*) AS requests, COALESCE(SUM(uh.promptTokens),0) AS promptTokens,
            COALESCE(SUM(uh.completionTokens),0) AS completionTokens, COALESCE(SUM(uh.cost),0) AS cost,
            COALESCE(SUM(CASE WHEN uh.status IS NOT NULL AND uh.status <> 'ok' THEN 1 ELSE 0 END),0) AS errors`;
  const totals = db.get(`SELECT ${sums} FROM usageHistory uh WHERE ${where}`, params);
  const group = (cols, alias, order = "requests DESC", limit = 200) =>
    db.all(`SELECT ${cols} AS ${alias}, ${sums} FROM usageHistory uh WHERE ${where} GROUP BY ${cols} ORDER BY ${order} LIMIT ${limit}`, params);
  return {
    tenantId: id, ...totals,
    byProvider: group("uh.provider", "provider"),
    byModel: db.all(`SELECT uh.provider AS provider, uh.model AS model, ${sums} FROM usageHistory uh WHERE ${where} GROUP BY uh.provider, uh.model ORDER BY requests DESC LIMIT 200`, params),
    byCombo: group("COALESCE(uh.requestedModel, '')", "combo"),
    byDay: group("substr(uh.timestamp, 1, 10)", "day", "day ASC", 400),
    byHour: group("substr(uh.timestamp, 1, 13)", "hour", "hour ASC", 720),
  };
}

// Log de requisicoes do tenant (mais recentes primeiro; paginacao por id). Nunca devolve a chave.
export async function getTenantRequests(id, { limit = 50, beforeId = null } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const params = [id];
  let where = `tenantId = ?`;
  if (beforeId) { where += ` AND id < ?`; params.push(Number(beforeId)); }
  const rows = db.all(
    `SELECT id, timestamp, provider, model, requestedModel, connectionId, endpoint, promptTokens, completionTokens, cost, status
       FROM usageHistory WHERE ${where} ORDER BY id DESC LIMIT ${lim}`, params);
  return { tenantId: id, requests: rows, nextBeforeId: rows.length === lim ? rows[rows.length - 1].id : null };
}

// Contagens de recursos do tenant (usado por /summary).
export async function getTenantCounts(id) {
  const db = await getAdapter();
  const n = (t) => db.get(`SELECT COUNT(*) AS n FROM ${t} WHERE tenantId = ?`, [id]).n;
  return { connections: n("providerConnections"), combos: n("combos"), keys: n("apiKeys"), nodes: n("providerNodes") };
}
