/**
 * The browser's single connection to the container's server (one WebSocket per tab).
 *
 * This file and its neighbours (firestore.ts, auth.ts, app.ts) are a stand-in for the Firebase
 * packages: when the app is built for the container (BACKEND=local, see next.config.mjs) the
 * imports "firebase/firestore", "firebase/auth" and "firebase/app" resolve to these files, so the
 * screens run unchanged. The Vercel build never includes them.
 */

export interface WireDoc {
  id: string;
  path: string;
  data: Record<string, unknown>;
  version: number;
}

export interface UserInfo {
  uid: string;
  email: string | null;
  isAnonymous: boolean;
  name?: string;
  /** Administrators approve teacher accounts. */
  isAdmin?: boolean;
}

export class LocalBackendError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "FirebaseError"; // the app's own code never checks this; it just reads nicely in logs
    this.code = code;
  }
}

type Reply = { t: "res"; rid: number; ok: boolean; code?: string; message?: string; [k: string]: unknown };
type Snap = { t: "snap"; sid: string; doc?: WireDoc | null; docs?: WireDoc[] };

interface SubHandler {
  message: Record<string, unknown>; // what to send to (re)subscribe
  onSnap: (snap: Snap) => void;
  onError: (code: string, message: string) => void;
}

const TOKEN_KEY = "cw-token";
const REQUEST_TIMEOUT_MS = 15000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function socketUrl(): string {
  const override = (globalThis as { __CW_WS_URL__?: string }).__CW_WS_URL__;
  if (override) return override;
  const loc = globalThis.location;
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
}

class Connection {
  private ws: WebSocket | null = null;
  private ready = false;
  private nextRid = 1;
  private nextSid = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private subs = new Map<string, SubHandler>();
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private authListeners = new Set<(u: UserInfo | null) => void>();
  private retryMs = 400;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private token: string | null = null; // kept here too, for browsers that refuse to store anything
  user: UserInfo | null = null;
  authKnown = false;

  /** Starts connecting (once). Called by everything that needs the server. */
  ensure() {
    if (typeof window === "undefined") return; // pages are also rendered on the server; only browsers connect
    if (this.ws || this.retryTimer) return;
    this.open();
  }

  private open() {
    this.retryTimer = null;
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 400;
      const token = storage()?.getItem(TOKEN_KEY) ?? this.token ?? undefined;
      this.rawRequest({ t: "hello", token })
        .then((r) => {
          this.setUser((r.user as UserInfo | null) ?? null);
          this.ready = true;
          // Everything that was being watched is asked for again; fresh snapshots come back.
          this.subs.forEach((s, sid) => this.rawSend({ ...s.message, t: "sub", sid }));
          this.readyWaiters.splice(0).forEach((w) => w.resolve());
        })
        .catch(() => ws.close());
    };
    ws.onmessage = (e) => {
      let m: Reply | Snap | { t: "suberr"; sid: string; code: string; message: string };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === "res") {
        const p = this.pending.get(m.rid);
        if (p) {
          this.pending.delete(m.rid);
          p.resolve(m);
        }
      } else if (m.t === "snap") {
        this.subs.get(m.sid)?.onSnap(m);
      } else if (m.t === "suberr") {
        this.subs.get(m.sid)?.onError(m.code, m.message);
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.ready = false;
      const err = new LocalBackendError("unavailable", "The connection to the server was lost.");
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5000);
  }

  private rawSend(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  private rawRequest(msg: Record<string, unknown>): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const rid = this.nextRid++;
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new LocalBackendError("deadline-exceeded", "The server did not answer in time."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(rid, {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.rawSend({ ...msg, rid });
    });
  }

  private whenReady(): Promise<void> {
    this.ensure();
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.readyWaiters.push(waiter);
      setTimeout(() => {
        const i = this.readyWaiters.indexOf(waiter);
        if (i >= 0) {
          this.readyWaiters.splice(i, 1);
          reject(new LocalBackendError("unavailable", "Cannot reach the server."));
        }
      }, 10000);
    });
  }

  /** Sends a request once connected and returns the server's answer; a refusal becomes a thrown error. */
  async request(msg: Record<string, unknown>): Promise<Reply> {
    await this.whenReady();
    const r = await this.rawRequest(msg);
    if (!r.ok) throw new LocalBackendError(r.code ?? "internal", r.message);
    return r;
  }

  /** Starts a live query / document watch. Returns the function that stops it. */
  subscribe(
    message: Record<string, unknown>,
    onSnap: (s: Snap) => void,
    onError: (code: string, message: string) => void
  ): () => void {
    this.ensure();
    const sid = `s${this.nextSid++}`;
    this.subs.set(sid, { message, onSnap, onError });
    if (this.ready) this.rawSend({ ...message, t: "sub", sid });
    return () => {
      if (this.subs.delete(sid)) this.rawSend({ t: "unsub", sid });
    };
  }

  private setUser(user: UserInfo | null) {
    this.user = user;
    this.authKnown = true;
    this.authListeners.forEach((l) => l(user));
  }

  /** Reports the signed-in user now (once known) and whenever it changes. */
  onAuth(listener: (u: UserInfo | null) => void): () => void {
    this.authListeners.add(listener);
    this.ensure();
    if (this.authKnown) {
      const u = this.user;
      Promise.resolve().then(() => this.authListeners.has(listener) && listener(u));
    }
    return () => {
      this.authListeners.delete(listener);
    };
  }

  /** Stores a new sign-in (token + user) returned by the server. */
  adopt(user: UserInfo, token: string) {
    this.token = token;
    try {
      storage()?.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode etc.: the sign-in then lasts until the tab closes */
    }
    this.setUser(user);
  }

  forgetUser() {
    this.token = null;
    try {
      storage()?.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    this.setUser(null);
  }
}

export const connection = new Connection();
