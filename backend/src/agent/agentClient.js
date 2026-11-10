import { AGENT_URL } from "../config.js";

/**
 * agentClient.js - Call the agent microservice's single POST /agent endpoint
 * and consume its SSE stream server-side.
 *
 * The backend is an SSE RELAY (research task #4): the browser's EventSource can
 * only do GET-with-no-body, so the frontend POSTs to the backend and the
 * backend POSTs to the agent, consuming the agent's SSE via fetch + a stream
 * reader (not EventSource). Each parsed event is handed to onEvent so the
 * caller can both relay it to the frontend and capture the final envelope.
 */

/**
 * @param {object} params
 * @param {object} params.body       - { engagementId, sessionId?, instruction, inputs }
 * @param {(event:string, data:any)=>void} params.onEvent - called per SSE event
 * @param {AbortSignal} [params.signal] - propagate frontend disconnect -> agent
 */
export async function callAgent({ body, onEvent, signal }) {
  const res = await fetch(`${AGENT_URL}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`agent responded ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Parse SSE frames: events are separated by a blank line; within a frame,
  // `event:` and `data:` lines carry the type and JSON payload.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      parseFrame(rawFrame, onEvent);
    }
  }
  // Flush any trailing frame.
  if (buffer.trim()) parseFrame(buffer, onEvent);
}

function parseFrame(rawFrame, onEvent) {
  let event = "message";
  const dataLines = [];
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith(":")) continue; // heartbeat comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  let data;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    data = { raw: dataLines.join("\n") };
  }
  onEvent(event, data);
}
