// Usage: VOICE_GATEWAY_API_KEY=... [VOICE_CONNECTION_ID=...] node scripts/smoke-voice-relay.mjs
// Sends only silent PCM. Never prints the client key or provider OAuth token.
import WebSocket from "ws";

const key = process.env.VOICE_GATEWAY_API_KEY;
if (!key) throw new Error("VOICE_GATEWAY_API_KEY is required");
const base = process.env.VOICE_GATEWAY_URL || "wss://gw.rangeltech.net/api/ws/speech_to_text/voice_stream";
const url = new URL(base);
url.searchParams.set("encoding", "linear16");
url.searchParams.set("sample_rate", "16000");
url.searchParams.set("channels", "1");
url.searchParams.set("endpointing_ms", "300");
url.searchParams.set("utterance_end_ms", "1000");
url.searchParams.set("language", "en");
url.searchParams.set("use_conversation_engine", "true");
const headers = { Authorization: `Bearer ${key}` };
if (process.env.VOICE_CONNECTION_ID) headers["x-9r-connection-id"] = process.env.VOICE_CONNECTION_ID;
const ws = new WebSocket(url, { headers, handshakeTimeout: 25000 });
const timeout = setTimeout(() => { console.error("Voice handshake timed out"); ws.terminate(); }, 30000);
ws.on("unexpected-response", (_req, response) => {
  clearTimeout(timeout);
  console.error(`Voice HTTP ${response.statusCode}`);
  process.exitCode = 1;
});
ws.on("open", () => {
  console.log("Voice WebSocket connected");
  ws.send(JSON.stringify({ type: "KeepAlive" }));
  ws.send(Buffer.alloc(9600)); // 300 ms of silent PCM16 at 16 kHz
  setTimeout(() => ws.send(JSON.stringify({ type: "CloseStream" })), 1000);
  setTimeout(() => ws.close(), 3000);
});
ws.on("message", (raw) => {
  try { console.log("Voice event:", JSON.parse(raw.toString()).type); }
  catch { console.log("Voice binary response"); }
});
ws.on("error", (error) => {
  console.error("Voice socket error:", error.message);
  process.exitCode = 1;
});
ws.on("close", (code) => {
  clearTimeout(timeout);
  console.log(`Voice socket closed (${code})`);
});
