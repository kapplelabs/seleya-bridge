import type { Run } from "../runs.ts";
import { getProviderMeta } from "./catalog.ts";
import type { StoredConnection } from "./store.ts";

export interface ProviderRunInput {
  prompt: string;
  modelId: string;
  connection: StoredConnection;
}

export async function runProviderStream(
  run: Run,
  input: ProviderRunInput,
): Promise<void> {
  const { prompt, modelId, connection } = input;
  const meta = getProviderMeta(connection.providerId);
  const providerName = meta?.name || connection.providerId;
  const assistantMessageId = `msg-${run.id}`;

  run.emit("seleya.message.started", {
    messageId: assistantMessageId,
    role: "assistant",
    model: `${providerName} · ${modelId}`,
  });

  const baseUrl = (meta?.baseUrl || "https://api.openai.com/v1/chat/completions").trim();
  const format = meta?.format || "openai";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
  };

  if (format === "claude") {
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${connection.apiKey}`;
  }

  let requestBody: Record<string, unknown>;
  if (format === "claude") {
    requestBody = {
      model: modelId,
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    requestBody = {
      model: modelId,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    };
  }

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: run.abort.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      let message = `Provider returned error ${response.status}`;
      try {
        const parsed = JSON.parse(errText) as { error?: { message?: string }; message?: string };
        message = parsed?.error?.message || parsed?.message || message;
      } catch {
        /* ignore parse error */
      }
      run.emit("seleya.error", { code: "upstream_error", message, retryable: true });
      run.emit("stream.done");
      return;
    }

    run.emit("seleya.block.started", { index: 0, type: "text" });

    if (!response.body) {
      run.emit("seleya.block.delta", { index: 0, text: "" });
      run.emit("seleya.message.completed", {
        messageId: assistantMessageId,
        tokens: { input: 0, output: 0 },
      });
      run.emit("stream.done");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed.startsWith("data: ")) {
          const payload = trimmed.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as {
              type?: string;
              delta?: { text?: string };
              choices?: Array<{ delta?: { content?: string } }>;
            };
            let chunkText = "";
            if (format === "claude") {
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                chunkText = parsed.delta.text;
              }
            } else {
              chunkText = parsed?.choices?.[0]?.delta?.content || "";
            }

            if (chunkText) {
              fullText += chunkText;
              run.emit("seleya.block.delta", { index: 0, text: chunkText });
            }
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }

    run.emit("seleya.message.completed", {
      messageId: assistantMessageId,
      tokens: { input: 0, output: fullText.length },
    });
    run.emit("stream.done");
  } catch (err: unknown) {
    if (run.abort.signal.aborted) {
      run.emit("stream.done");
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to reach AI provider";
    run.emit("seleya.error", {
      code: "network_error",
      message,
      retryable: true,
    });
    run.emit("stream.done");
  }
}
