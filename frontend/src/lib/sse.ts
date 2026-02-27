/**
 * Shared SSE (Server-Sent Events) parsing utilities.
 * Used by AIAssistant and PolicyGeneratorModal.
 */

export type StreamCallbacks = { onToken: (t: string) => void; onDone: () => void };

/** Strips <think>...</think> reasoning blocks from streamed tokens. Stateful across calls. */
export function makeThinkFilter() {
  let insideThink = false;
  let buffer = "";

  return function filter(raw: string): string {
    buffer += raw;
    let out = "";

    while (buffer.length > 0) {
      if (insideThink) {
        const closeIdx = buffer.indexOf("</think>");
        if (closeIdx === -1) {
          buffer = buffer.length > 8 ? buffer.slice(-8) : buffer;
          return out;
        }
        insideThink = false;
        buffer = buffer.slice(closeIdx + 8).replace(/^\n+/, "");
      } else {
        const openIdx = buffer.indexOf("<think>");
        if (openIdx === -1) {
          out += buffer;
          buffer = "";
        } else {
          out += buffer.slice(0, openIdx);
          insideThink = true;
          buffer = buffer.slice(openIdx + 7);
        }
      }
    }
    return out;
  };
}

/** Parse one SSE line and call the appropriate callback. Returns true if stream should stop. */
export function handleSseLine(
  line: string,
  { onToken, onDone }: StreamCallbacks,
  filter: (t: string) => string,
): boolean {
  if (!line.startsWith("data: ")) return false;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") {
    onDone();
    return true;
  }
  try {
    const data = JSON.parse(payload);
    if (data.token) {
      const filtered = filter(data.token);
      if (filtered) onToken(filtered);
    }
    if (data.error) {
      onToken(`\u26a0\ufe0f ${data.error}`);
      onDone();
      return true;
    }
  } catch {
    // ignore malformed JSON lines
  }
  return false;
}

/** Read a fetch response body as SSE and call onToken/onDone. */
export async function readSseStream(
  response: Response,
  onToken: (token: string) => void,
  onDone: () => void,
): Promise<void> {
  if (!response.body) {
    onDone();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const filter = makeThinkFilter();
  const cbs: StreamCallbacks = { onToken, onDone };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value, { stream: true }).split("\n");
    for (const line of lines) {
      if (handleSseLine(line, cbs, filter)) return;
    }
  }
  onDone();
}
