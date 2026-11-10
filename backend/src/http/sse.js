/**
 * sse.js - Minimal SSE writer for streaming to the frontend, with the
 * reliability guards from architecture-v1.md 4.2 (flushHeaders, X-Accel-
 * Buffering off, guarded writes, close-safety). Mirrors the agent service's
 * SseStream; kept separate so the backend owns its own frontend transport.
 */
export class SseStream {
  constructor(res) {
    this.res = res;
    this.id = 0;
    this.closed = false;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.on("error", () => { this.closed = true; });
    res.on("close", () => { this.closed = true; });
  }

  send(event, data) {
    if (this.closed) return;
    try {
      this.res.write(`id: ${++this.id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.closed = true;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.res.end(); } catch { /* already closed */ }
  }
}
