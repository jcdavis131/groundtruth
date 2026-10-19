"use client";
// ElevenLabs Conversational AI. The agent runs in ElevenLabs' cloud; every
// command in lib/voice/commands.ts is exposed to it as a *client tool*, so
// "show me flights over Austin" becomes a show_layer({layer:"aircraft",
// on:true, place:"Austin"}) call executed here in the browser.
//
// Dashboard setup (once): create an agent, add client tools whose names and
// parameter schemas match toolDefinitions() — the README prints the JSON.

import { Conversation } from "@elevenlabs/client";
import { COMMANDS, runCommand } from "./commands";
import type { VoiceSession, VoiceSessionHandlers } from "./types";
import { keyHeaders } from "@/lib/store/settings";

export async function startElevenLabs(
  agentId: string,
  apiKey: string | undefined,
  h: VoiceSessionHandlers,
): Promise<VoiceSession> {
  await navigator.mediaDevices.getUserMedia({ audio: true });

  const clientTools = Object.fromEntries(
    COMMANDS.map((c) => [
      c.name,
      async (parameters: Record<string, unknown>) => runCommand(c.name, parameters ?? {}),
    ]),
  );

  let signedUrl: string | undefined;
  if (apiKey) {
    const res = await fetch(`/api/voice/elevenlabs?agent=${encodeURIComponent(agentId)}`, {
      headers: keyHeaders({ ELEVENLABS_API_KEY: apiKey }),
    });
    const json = (await res.json()) as { signedUrl?: string; error?: string };
    if (!res.ok || !json.signedUrl) throw new Error(json.error ?? "could not get signed URL");
    signedUrl = json.signedUrl;
  }

  const common = {
    clientTools,
    onConnect: () => h.onStatus("listening"),
    onDisconnect: () => h.onStatus("idle"),
    onError: (message: string) => h.onError(message),
    onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
      if (source === "user") h.onTranscript(message, true);
      else h.onReply(message);
    },
    onModeChange: ({ mode }: { mode: "speaking" | "listening" }) =>
      h.onStatus(mode === "speaking" ? "speaking" : "listening"),
    onStatusChange: ({ status }: { status: string }) => {
      if (status === "connecting") h.onStatus("connecting");
      if (status === "disconnected") h.onStatus("idle");
    },
    onUnhandledClientToolCall: (call: { tool_name: string }) =>
      h.onError(`agent called unknown tool ${call.tool_name}; add it to the agent's client tools`),
  };

  const conversation = signedUrl
    ? await Conversation.startSession({ signedUrl, connectionType: "websocket", ...common })
    : await Conversation.startSession({ agentId, connectionType: "websocket", ...common });

  return {
    stop: () => {
      void conversation.endSession();
    },
  };
}
