import { Router } from "express";
import { SseStream } from "./http/sse.js";
import { runAgent } from "./runner.js";

export const agentRouter = Router();

/**
 * POST /agent
 * Body: { engagementId?, sessionId?, instruction, inputs? }
 *
 * Single instruction-driven endpoint. Streams layered SSE events
 * (run_started, plan, activity, result, run_finished | run_error) and returns
 * the AgentEnvelope in the terminal `result` event.
 *
 * The agent is domain-agnostic: engagementId is an opaque correlation id.
 */
agentRouter.post("/agent", async (req, res) => {
  const body = req.body || {};

  if (!body.instruction || typeof body.instruction !== "string" || !body.instruction.trim()) {
    return res.status(400).json({ error: "instruction is required" });
  }

  const stream = new SseStream(res);

  // Abort the run when the client disconnects, so an abandoned request does not
  // keep the ACP process running and burning credits (architecture 4.2).
  //
  // NOTE: listen on the RESPONSE, not the request. For an SSE response to a
  // POST, `req` emits 'close' as soon as the request BODY is fully read (within
  // ~1ms), which is NOT a disconnect. `res` emits 'close' only when the
  // underlying connection to the client actually ends.
  const controller = new AbortController();
  res.on("close", () => {
    controller.abort();
    stream.close();
  });

  try {
    await runAgent({ body, stream, signal: controller.signal });
  } catch (err) {
    try {
      await stream.send("run_error", { message: err.message });
    } catch {
      /* stream already gone */
    }
  } finally {
    stream.close();
  }
});
