import { SSE_HEARTBEAT_MS } from "../config.js";

/**
 * sse.js - Server-Sent Events writer with the reliability guards from
 * architecture-v1.md section 4.2:
 *   - flush headers before the first chunk (avoid header/first-chunk batching)
 *   - X-Accel-Buffering: no (defeat nginx/proxy response buffering)
 *   - heartbeat comments every SSE_HEARTBEAT_MS (defeat proxy idle timeouts)
 *   - cooperative backpressure: await 'drain' when res.write() returns false
 *   - monotonic event ids so a client can resume via Last-Event-ID
 *
 * Layered event model (4.2 / AG-UI): lifecycle (run_started/run_finished/
 * run_error), semantic (plan/activity), and result (the final envelope).
 */
export class SseStream {
  constructor(res) {
    this.res = res;
    this.id = 0;
    this.closed = false;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Defeat proxy buffering (nginx and others honor this).
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // If the underlying socket errors (client vanished, EPIPE/ECONNRESET),
    // mark closed so no further write is attempted. Without this listener a
    // write-after-close throws an unhandled error and crashes the process.
    res.on("error", () => { this.closed = true; });
    res.on("close", () => { this.closed = true; });

    // Heartbeat: a comment line keeps the connection alive through idle proxies.
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      try {
        this.res.write(`: heartbeat\n\n`);
      } catch {
        this.closed = true;
      }
    }, SSE_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /**
   * Write one SSE event, applying cooperative backpressure. Returns a promise
   * that resolves once the chunk is flushed (or the buffer has drained).
   * Safe to call after disconnect: becomes a no-op rather than throwing.
   */
  async send(event, data) {
    if (this.closed) return;
    const frame =
      `id: ${++this.id}\n` +
      `event: ${event}\n` +
      `data: ${JSON.stringify(data)}\n\n`;
    let ok;
    try {
      ok = this.res.write(frame);
    } catch {
      // Socket gone mid-write (EPIPE/ECONNRESET): stop streaming quietly.
      this.closed = true;
      return;
    }
    if (!ok) {
      // Kernel write buffer full: wait for it to drain before continuing so we
      // never buffer unboundedly in memory (4.2 backpressure). Bail if the
      // connection closes while we wait.
      await new Promise((resolve) => {
        const done = () => resolve();
        this.res.once("drain", done);
        this.res.once("close", done);
        this.res.once("error", done);
      });
    }
  }

  close() {
    if (this.closed) {
      clearInterval(this.heartbeat);
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeat);
    try {
      this.res.end();
    } catch {
      /* already closed */
    }
  }
}
