import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import relay from "../../voice-relay.js";

const { attachVoiceRelay, VOICE_PATH, voiceQuery } = relay;
const servers = [];
const sockets = [];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server.address().port;
}

async function connect(url, headers = {}) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => { sockets.push(ws); resolve(ws); });
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      reject(Object.assign(new Error("rejected"), { status: response.statusCode }));
    });
    ws.once("error", reject);
  });
}

async function message(ws) {
  return await new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
    ws.once("error", reject);
  });
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
});

describe("Anthropic voice relay", () => {
  it("validates the fixed upstream path and audio format", () => {
    expect(voiceQuery(VOICE_PATH + "?language=pt").get("language")).toBe("pt");
    expect(() => voiceQuery(VOICE_PATH + "?sample_rate=48000")).toThrow();
    expect(() => voiceQuery(VOICE_PATH + "?target=evil.example")).toThrow();
    expect(voiceQuery("/other")).toBeNull();
  });

  it("routes independent PCM streams over two accounts and reuses one account", async () => {
    const upstreamServer = http.createServer();
    const upstreamWs = new WebSocketServer({ server: upstreamServer });
    const seen = [];
    upstreamWs.on("connection", (ws, request) => {
      const account = request.headers.authorization?.replace("Bearer token-", "");
      seen.push(account);
      ws.on("message", (data, binary) => {
        if (binary) ws.send(JSON.stringify({ type: "TranscriptText", data: `${account}:${data.toString("hex")}` }));
        else if (String(data).includes("CloseStream")) ws.send(JSON.stringify({ type: "TranscriptEndpoint" }));
      });
    });
    const upstreamPort = await listen(upstreamServer);
    const gateway = http.createServer((_req, res) => res.end("ok"));
    const selected = [];
    const state = attachVoiceRelay(gateway, {
      secret: "internal", upstreamUrl: `ws://127.0.0.1:${upstreamPort}`,
      prepare: async ({ apiKey, voiceLoads }) => {
        if (apiKey !== "valid") throw Object.assign(new Error("invalid"), { status: 401 });
        const account = (voiceLoads.outlook || 0) <= (voiceLoads.quality || 0) ? "outlook" : "quality";
        selected.push(account);
        return { connectionId: account, accessToken: `token-${account}` };
      },
    });
    const port = await listen(gateway);
    const url = `ws://127.0.0.1:${port}${VOICE_PATH}?language=pt`;
    const a = await connect(url, { Authorization: "Bearer valid" });
    const b = await connect(url, { Authorization: "Bearer valid" });
    const c = await connect(url, { Authorization: "Bearer valid" });
    expect(selected).toEqual(["outlook", "quality", "outlook"]);
    expect(seen).toEqual(selected);
    expect(Object.fromEntries(state.active)).toEqual({ outlook: 2, quality: 1 });
    const replyA = message(a); a.send(Buffer.from([1, 2]));
    const replyB = message(b); b.send(Buffer.from([3, 4]));
    expect(await replyA).toEqual({ type: "TranscriptText", data: "outlook:0102" });
    expect(await replyB).toEqual({ type: "TranscriptText", data: "quality:0304" });
    const end = message(c); c.send(JSON.stringify({ type: "CloseStream" }));
    expect(await end).toEqual({ type: "TranscriptEndpoint" });
    await expect(connect(url, { Authorization: "Bearer wrong" })).rejects.toMatchObject({ status: 401 });
    state.close();
    upstreamWs.close();
  });
});
