"use strict";

const { WebSocket, WebSocketServer } = require("ws");

const VOICE_PATH = "/api/ws/speech_to_text/voice_stream";
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_SESSION_MS = 6 * 60 * 1000;
const IDLE_MS = 30 * 1000;
const MAX_CONNECTIONS = 64;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const QUERY_KEYS = new Set(["encoding", "sample_rate", "channels", "endpointing_ms",
                            "utterance_end_ms", "language", "use_conversation_engine", "stt_provider"]);

function voiceQuery(rawUrl) {
  const parsed = new URL(rawUrl, "http://localhost");
  if (parsed.pathname !== VOICE_PATH) return null;
  const seen = new Set();
  for (const key of parsed.searchParams.keys()) {
    if (!QUERY_KEYS.has(key)) throw new Error("Unsupported voice parameter");
    if (seen.has(key)) throw new Error("Duplicate voice parameter");
    seen.add(key);
  }
  const param = (key, fallback) => parsed.searchParams.get(key) || fallback;
  if (param("encoding", "linear16") !== "linear16" || param("sample_rate", "16000") !== "16000" ||
      param("channels", "1") !== "1") throw new Error("Voice requires PCM16 mono at 16 kHz");
  for (const key of ["endpointing_ms", "utterance_end_ms"]) {
    const value = Number(param(key, key === "endpointing_ms" ? "300" : "1000"));
    if (!Number.isSafeInteger(value) || value < 100 || value > 10000) throw new Error("Invalid voice timing");
  }
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(param("language", "en"))) throw new Error("Invalid voice language");
  if (!["true", "false"].includes(param("use_conversation_engine", "true"))) throw new Error("Invalid voice option");
  if (parsed.searchParams.has("stt_provider") && !/^[a-z0-9_-]{1,40}$/.test(param("stt_provider", ""))) {
    throw new Error("Invalid STT provider");
  }
  const query = new URLSearchParams(parsed.searchParams);
  for (const [key, value] of Object.entries({ encoding: "linear16", sample_rate: "16000", channels: "1",
    endpointing_ms: "300", utterance_end_ms: "1000", language: "en", use_conversation_engine: "true" })) {
    if (!query.has(key)) query.set(key, value);
  }
  return query;
}

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed || socket.writableEnded) return;
  const text = String(message || "Voice connection unavailable");
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Unavailable"}\r\n` +
    "Connection: close\r\nContent-Type: text/plain\r\n" +
    `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
}

function attachVoiceRelay(server, { secret, upstreamUrl = "wss://api.anthropic.com", prepare,
                                    WebSocketImpl = WebSocket, maxConnections = MAX_CONNECTIONS }) {
  if (!secret || typeof prepare !== "function") throw new Error("Voice relay needs an internal secret and prepare function");
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES,
                                        clientTracking: false, perMessageDeflate: false });
  const active = new Map();
  let total = 0;
  let admission = Promise.resolve();

  server.on("upgrade", (req, socket, head) => {
    let query;
    try { query = voiceQuery(req.url || ""); } catch (error) {
      if ((req.url || "").split("?", 1)[0] === VOICE_PATH) rejectUpgrade(socket, 400, error.message);
      return;
    }
    if (!query) return;
    const auth = req.headers.authorization || "";
    const apiKey = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-api-key"];
    if (!apiKey || typeof apiKey !== "string") return rejectUpgrade(socket, 401, "API key required");
    if (total >= maxConnections) return rejectUpgrade(socket, 503, "Voice capacity reached");
    const pinned = req.headers["x-9r-connection-id"];
    if (pinned && (typeof pinned !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(pinned))) {
      return rejectUpgrade(socket, 400, "Invalid connection selector");
    }
    socket.on("error", () => {});
    const select = admission.then(async () => {
      if (total >= maxConnections) throw Object.assign(new Error("Voice capacity reached"), { status: 503 });
      const loads = Object.fromEntries(active);
      const credential = await prepare({ apiKey, connectionId: pinned || null, voiceLoads: loads, secret, server });
      if (!credential?.accessToken || !credential?.connectionId) {
        throw Object.assign(new Error("No eligible Claude account"), { status: 503 });
      }
      total += 1;
      active.set(credential.connectionId, (active.get(credential.connectionId) || 0) + 1);
      return credential;
    });
    admission = select.catch(() => {});
    select.then((credential) => {
      if (socket.destroyed) { release(credential.connectionId); return; }
      const target = new URL(VOICE_PATH + "?" + query.toString(), upstreamUrl);
      let upstream;
      try {
        upstream = new WebSocketImpl(target.toString(), { headers: {
          Authorization: `Bearer ${credential.accessToken}`, "x-app": "vscode" },
          maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, handshakeTimeout: 15000 });
      } catch {
        release(credential.connectionId);
        return rejectUpgrade(socket, 502, "Voice upstream unavailable");
      }
      let client = null;
      let released = false;
      let lastActivity = Date.now();
      const releaseOnce = () => { if (!released) { released = true; release(credential.connectionId); } };
      const closeBoth = (code = 1000) => {
        if (client && client.readyState === WebSocket.OPEN) client.close(code);
        if (upstream.readyState === WebSocket.OPEN) upstream.close(code);
        else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        if (!client && !socket.destroyed) socket.destroy();
        releaseOnce();
      };
      const maxTimer = setTimeout(() => closeBoth(1000), MAX_SESSION_MS);
      const idleTimer = setInterval(() => {
        if (Date.now() - lastActivity > IDLE_MS) closeBoth(1000);
      }, 5000);
      const cleanup = () => { clearTimeout(maxTimer); clearInterval(idleTimer); releaseOnce(); };
      upstream.once("open", () => {
        if (socket.destroyed) { upstream.close(); cleanup(); return; }
        wsServer.handleUpgrade(req, socket, head, (accepted) => {
          client = accepted;
          client.on("message", (data, isBinary) => {
            lastActivity = Date.now();
            if (upstream.readyState === WebSocket.OPEN) {
              if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) return closeBoth(1013);
              upstream.send(data, { binary: isBinary });
            }
          });
          client.on("close", () => { cleanup(); if (upstream.readyState === WebSocket.OPEN) upstream.close(); });
          client.on("error", () => closeBoth(1011));
        });
      });
      upstream.on("message", (data, isBinary) => {
        lastActivity = Date.now();
        if (client?.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > MAX_BUFFERED_BYTES) return closeBoth(1013);
          client.send(data, { binary: isBinary });
        }
      });
      upstream.on("close", (code) => {
        cleanup();
        if (client?.readyState === WebSocket.OPEN) client.close(code >= 1000 && code < 5000 ? code : 1011);
        else if (!socket.destroyed) rejectUpgrade(socket, 502, "Voice upstream unavailable");
      });
      upstream.on("unexpected-response", (_request, response) => {
        cleanup();
        if (!socket.destroyed) rejectUpgrade(socket, 502, `Voice upstream HTTP ${response.statusCode}`);
        upstream.terminate();
      });
      upstream.on("error", () => {
        cleanup();
        if (client) closeBoth(1011);
        else rejectUpgrade(socket, 502, "Voice upstream unavailable");
      });
    }).catch((error) => rejectUpgrade(socket, error.status || 503, error.status === 401 ? "Invalid API key" :
      "Voice account unavailable"));
  });

  function release(connectionId) {
    total = Math.max(0, total - 1);
    const count = (active.get(connectionId) || 1) - 1;
    if (count > 0) active.set(connectionId, count);
    else active.delete(connectionId);
  }
  return { active, close: () => wsServer.close() };
}

module.exports = { attachVoiceRelay, voiceQuery, VOICE_PATH };
