"use client";
// Vapi realtime assistant. Function tools are declared on the assistant
// (dashboard, or the override below) as *async* client tools; when the model
// calls one we run it here and push the result back as a system message.

import Vapi from "@vapi-ai/web";
import { runCommand, toolDefinitions } from "./commands";
import type { VoiceSession, VoiceSessionHandlers } from "./types";

interface VapiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

interface VapiMessage {
  type?: string;
  role?: "user" | "assistant";
  transcript?: string;
  transcriptType?: "partial" | "final";
  toolCallList?: VapiToolCall[];
  functionCall?: { name?: string; parameters?: Record<string, unknown> | string };
}

function parseArgs(a: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!a) return {};
  if (typeof a === "string") {
    try {
      return JSON.parse(a) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return a;
}

export async function startVapi(
  publicKey: string,
  assistantId: string,
  h: VoiceSessionHandlers,
): Promise<VoiceSession> {
  const vapi = new Vapi(publicKey);
  vapi.on("call-start", () => h.onStatus("listening"));
  vapi.on("call-end", () => h.onStatus("idle"));
  vapi.on("speech-start", () => h.onStatus("speaking"));
  vapi.on("speech-end", () => h.onStatus("listening"));
  vapi.on("error", (e: unknown) => {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e).slice(0, 160);
    h.onError(msg);
  });
  vapi.on("message", (raw: unknown) => {
    const msg = raw as VapiMessage;
    if (msg.type === "transcript" && msg.transcript) {
      if (msg.role === "user") h.onTranscript(msg.transcript, msg.transcriptType === "final");
      else if (msg.transcriptType === "final") h.onReply(msg.transcript);
      return;
    }
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    if (msg.type === "tool-calls") {
      for (const tc of msg.toolCallList ?? []) {
        if (tc.function?.name) calls.push({ name: tc.function.name, args: parseArgs(tc.function.arguments) });
      }
    } else if (msg.type === "function-call" && msg.functionCall?.name) {
      calls.push({ name: msg.functionCall.name, args: parseArgs(msg.functionCall.parameters) });
    }
    for (const c of calls) {
      void runCommand(c.name, c.args).then((result) => {
        vapi.send({
          type: "add-message",
          message: { role: "system", content: `Result of ${c.name}: ${result}` },
          triggerResponseEnabled: true,
        });
      });
    }
  });

  // Advertise the cockpit tools on the call so a bare assistant works too.
  const tools = toolDefinitions().map((t) => ({ ...t, async: true }));
  const overrides = { model: { tools } } as unknown as Parameters<typeof vapi.start>[1];
  await vapi.start(assistantId, overrides);

  return {
    stop: () => {
      void vapi.stop();
    },
  };
}
