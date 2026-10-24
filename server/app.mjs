import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Store, splitPath, checkDocPath, checkCollPath } from "./store.mjs";
import { StoreError } from "./errors.mjs";
import { parseSpec, runQuery } from "./query.mjs";
import { attachWebSocket } from "./websocket.mjs";
import { allowAll } from "./rules.mjs";

/**
 * The whole backend in one object: HTTP (health check + the Next.js pages), one WebSocket per
 * browser tab, and the SQLite store. It speaks a small JSON protocol (see README "Protocol"):
 *
 *   browser -> server  {t:"hello", rid, token?}                    who am I?
 *                      {t:"anon", rid} / {t:"signout", rid}
 *                      {t:"sub", sid, kind:"doc"|"query", path, where?, order?}   live updates
 *                      {t:"unsub", sid}
 *                      {t:"get", rid, kind, path, where?, order?}  one-off read
 *                      {t:"commit", rid, writes:[...], reads?:{path:version}}
 *   server -> browser  {t:"res", rid, ok, ...}                     answer to a request
 *                      {t:"snap", sid, doc|docs}                   current result of a live query
 *                      {t:"suberr", sid, code, message}
 *
 * A write is applied, every affected live query is re-sent, and only THEN is the writer answered,
 * so a browser always sees the effect of its own write before the confirmation of it.
 */
export function createBackend({ dataFile, secret, rules = allowAll, nextHandler = null, log = () => {} }) {
  const store = new Store(dataFile);

  let key = secret || store.getMeta("secret");
  if (!key) {
    key = randomBytes(32).toString("hex");
    store.setMeta("secret", key);
  }

  const mac = (uid) => createHmac("sha256", key).update(uid).digest("base64url");
  const signToken = (uid) => `${uid}.${mac(uid)}`;
  function uidFromToken(token) {
    if (typeof token !== "string") return null;
    const i = token.lastIndexOf(".");
    if (i < 1) return null;
    const uid = token.slice(0, i);
    const given = Buffer.from(token.slice(i + 1));
    const want = Buffer.from(mac(uid));
    return given.length === want.length && timingSafeEqual(given, want) ? uid : null;
  }
  const userFor = (uid) => ({ uid, email: null, isAnonymous: true });

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/healthz") {
      try {
        store.getMeta("secret");
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } catch {
        res.writeHead(500, { "content-type": "text/plain" }).end("database error");
      }
      return;
    }
    if (nextHandler) return nextHandler(req, res);
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });

  const clients = new Set();

  function evaluate(sub) {
    if (sub.kind === "doc") return { doc: store.getDoc(sub.path) };
    return { docs: runQuery(store.listColl(sub.path), sub.spec) };
  }

  function sendSnap(c, sid, sub, force, cache) {
    let payload;
    if (cache) {
      const k = `${sub.kind}|${sub.path}|${sub.kind === "query" ? JSON.stringify(sub.spec) : ""}`;
      if (!cache.has(k)) cache.set(k, JSON.stringify(evaluate(sub)));
      payload = cache.get(k);
    } else {
      payload = JSON.stringify(evaluate(sub));
    }
    if (!force && payload === sub.last) return;
    sub.last = payload;
    c.ws.send(`{"t":"snap","sid":${JSON.stringify(sid)},${payload.slice(1)}`);
  }

  function notify(changed) {
    const docs = new Set(changed);
    const colls = new Set(changed.map((p) => splitPath(p).coll));
    const cache = new Map();
    for (const c of clients) {
      for (const [sid, sub] of c.subs) {
        if (sub.kind === "doc" ? docs.has(sub.path) : colls.has(sub.path)) sendSnap(c, sid, sub, false, cache);
      }
    }
  }

  function handle(c, text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return c.ws.close(1003);
    }
    if (m === null || typeof m !== "object") return c.ws.close(1003);
    const send = (o) => c.ws.send(JSON.stringify(o));
    const reply = (extra = {}) => send({ t: "res", rid: m.rid, ok: true, ...extra });
    const fail = (err) => send({ t: "res", rid: m.rid, ok: false, code: err.code, message: err.message });

    try {
      switch (m.t) {
        case "hello": {
          const uid = uidFromToken(m.token);
          c.user = uid ? userFor(uid) : null;
          return reply({ user: c.user });
        }
        case "anon": {
          const uid = randomBytes(14).toString("hex");
          c.user = userFor(uid);
          return reply({ user: c.user, token: signToken(uid) });
        }
        case "signout": {
          c.user = null;
          return reply();
        }
        case "signup":
        case "login":
          throw new StoreError("auth/operation-not-allowed", "Teacher accounts are not available in this build yet.");
        case "sub": {
          const sid = String(m.sid);
          try {
            if (c.subs.size >= 200) throw new StoreError("resource-exhausted", "Too many live queries");
            let sub;
            if (m.kind === "doc") {
              checkDocPath(m.path);
              sub = { kind: "doc", path: m.path };
            } else {
              checkCollPath(m.path);
              sub = { kind: "query", path: m.path, spec: parseSpec(m) };
            }
            rules.canRead(c.user, m.path, store);
            c.subs.set(sid, sub);
            sendSnap(c, sid, sub, true);
          } catch (err) {
            if (!(err instanceof StoreError)) throw err;
            send({ t: "suberr", sid, code: err.code, message: err.message });
          }
          return;
        }
        case "unsub":
          c.subs.delete(String(m.sid));
          return;
        case "get": {
          let sub;
          if (m.kind === "doc") {
            checkDocPath(m.path);
            sub = { kind: "doc", path: m.path };
          } else {
            checkCollPath(m.path);
            sub = { kind: "query", path: m.path, spec: parseSpec(m) };
          }
          rules.canRead(c.user, m.path, store);
          return reply(evaluate(sub));
        }
        case "commit": {
          rules.canWrite(c.user, m.writes, store);
          const changed = store.commit(m.writes, m.reads ?? {});
          notify(changed);
          return reply();
        }
        default:
          throw new StoreError("invalid-argument", `Unknown message: ${m.t}`);
      }
    } catch (err) {
      if (err instanceof StoreError) return fail(err);
      log("error", err);
      return fail(new StoreError("internal", "Server error"));
    }
  }

  attachWebSocket(server, {
    path: "/ws",
    onConnection(ws) {
      const c = { ws, user: null, subs: new Map() };
      clients.add(c);
      ws.on("message", (text) => handle(c, text));
      ws.on("close", () => clients.delete(c));
    },
  });

  return {
    server,
    store,
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      for (const c of clients) c.ws.close(1001);
      return new Promise((resolve) => {
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
