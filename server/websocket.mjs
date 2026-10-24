import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * A small WebSocket server (RFC 6455), so the app needs no outside software for it.
 * It does only what this app needs: text messages, ping/pong, clean close.
 */

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const PING_EVERY_MS = 25_000;

class WsConnection extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragSize = 0;
    this.closed = false;
    this.alive = true;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("close", () => this.#finish());
    socket.on("error", () => this.#finish());
    this.pinger = setInterval(() => {
      if (!this.alive) return this.terminate();
      this.alive = false;
      this.#frame(0x9, Buffer.alloc(0));
    }, PING_EVERY_MS);
    this.pinger.unref();
  }

  feed(chunk) {
    this.#onData(chunk);
  }

  send(text) {
    if (this.closed) return;
    if (this.socket.writableLength > 16 * 1024 * 1024) return this.terminate(); // client far behind
    this.#frame(0x1, Buffer.from(text, "utf8"));
  }

  close(code = 1000) {
    if (this.closed) return;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code);
    this.#frame(0x8, body);
    this.socket.end();
  }

  terminate() {
    this.socket.destroy();
    this.#finish();
  }

  #finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    this.emit("close");
  }

  #frame(opcode, payload) {
    if (this.closed && opcode !== 0x8) return;
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  #fail(code) {
    this.close(code);
    this.#finish();
  }

  #onData(chunk) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) return this.#fail(1009);
        len = Number(big);
        offset = 10;
      }
      if (!masked) return this.#fail(1002); // browsers always mask
      if (len > this.maxPayload) return this.#fail(1009);
      if (b.length < offset + 4 + len) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(offset + 4 + len);

      if (opcode >= 0x8) {
        if (!fin || len > 125) return this.#fail(1002);
        if (opcode === 0x8) {
          this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000);
          this.#finish();
          return;
        }
        if (opcode === 0x9) this.#frame(0xa, payload);
        continue; // pong: nothing to do
      }
      if (opcode === 0x1 || opcode === 0x2) {
        if (this.fragments.length) return this.#fail(1002);
        this.fragOpcode = opcode;
      } else if (opcode !== 0x0 || !this.fragments.length) {
        return this.#fail(1002);
      }
      this.fragments.push(payload);
      this.fragSize += payload.length;
      if (this.fragSize > this.maxPayload) return this.#fail(1009);
      if (fin) {
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        this.fragSize = 0;
        if (this.fragOpcode === 0x1) this.emit("message", whole.toString("utf8"));
      }
    }
  }
}

/** Lets `server` (a node http server) accept WebSocket connections on `path`. */
export function attachWebSocket(server, { path, onConnection, maxPayload = 1024 * 1024 }) {
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const key = req.headers["sec-websocket-key"];
    if (
      url.pathname !== path ||
      !key ||
      String(req.headers.upgrade).toLowerCase() !== "websocket" ||
      req.headers["sec-websocket-version"] !== "13"
    ) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WsConnection(socket, maxPayload);
    onConnection(conn, req);
    if (head && head.length) conn.feed(head);
  });
}
