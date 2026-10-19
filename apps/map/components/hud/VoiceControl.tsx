"use client";
// Mic button + transcript strip. Provider comes from settings:
//   browser     Web Speech API + local intent parser (default, no key)
//   elevenlabs  ElevenLabs Conversational AI agent with client tools
//   vapi        Vapi web SDK assistant with function calls

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useSettings } from "@/lib/store/settings";
import { useGlobe } from "@/lib/store/globe";
import type { VoiceSession, VoiceStatus } from "@/lib/voice/types";

/** `compact`: icon-only button for the phone header; the transcript popover drops below it. */
export default function VoiceControl({ compact = false }: { compact?: boolean } = {}) {
  const provider = useSettings((s) => s.prefs.voiceProvider);
  const keys = useSettings((s) => s.keys);
  const pushLog = useGlobe((s) => s.pushLog);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const sessionRef = useRef<VoiceSession | null>(null);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => () => sessionRef.current?.stop(), []);

  const start = useCallback(async () => {
    setTranscript("");
    setReply("");
    const handlers = {
      onStatus: setStatus,
      onTranscript: (t: string) => setTranscript(t),
      onReply: (r: string) => setReply(r),
      onError: (m: string) => {
        pushLog({ level: "warn", text: `Voice: ${m}` });
        setReply(m);
      },
    };
    setStatus("connecting");
    try {
      if (provider === "elevenlabs" && keys.ELEVENLABS_AGENT_ID) {
        const { startElevenLabs } = await import("@/lib/voice/elevenlabs");
        sessionRef.current = await startElevenLabs(keys.ELEVENLABS_AGENT_ID, keys.ELEVENLABS_API_KEY, handlers);
      } else if (provider === "vapi" && keys.VAPI_PUBLIC_KEY && keys.VAPI_ASSISTANT_ID) {
        const { startVapi } = await import("@/lib/voice/vapi");
        sessionRef.current = await startVapi(keys.VAPI_PUBLIC_KEY, keys.VAPI_ASSISTANT_ID, handlers);
      } else {
        const { startWebSpeech, webSpeechSupported } = await import("@/lib/voice/webSpeech");
        if (!webSpeechSupported()) {
          setStatus("unsupported");
          handlers.onError("This browser has no Web Speech API. Use Chrome/Edge, or add an ElevenLabs/Vapi key.");
          return;
        }
        sessionRef.current = startWebSpeech(handlers);
      }
    } catch (err) {
      handlers.onError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }, [provider, keys, pushLog]);

  const active = status !== "idle" && status !== "unsupported";
  const label =
    status === "listening"
      ? "Listening"
      : status === "thinking"
        ? "Working"
        : status === "speaking"
          ? "Speaking"
          : status === "connecting"
            ? "Connecting"
            : "Voice";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (active ? stop() : start())}
        className={`${compact ? "flex size-9 items-center justify-center" : "hud-btn"} ${
          active ? "bg-alert/15 text-alert" : "text-foreground/80 hover:bg-accent hover:text-primary"
        }`}
        aria-label={compact ? label : undefined}
        title={`Voice control (${provider}). Try: "show me flights over Austin"`}
      >
        {status === "connecting" || status === "thinking" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : active ? (
          <Mic className="size-3.5 blink" />
        ) : (
          <MicOff className="size-3.5" />
        )}
        {!compact && <span className="hidden 2xl:inline">{label}</span>}
      </button>
      {(transcript || reply) && (
        <div className="hud-panel absolute right-0 top-[calc(100%+8px)] w-[320px] max-w-[calc(100vw-16px)] px-3 py-2 text-[11px]">
          {transcript && (
            <div className="text-foreground/90">
              <span className="hud-label mr-2">you</span>
              {transcript}
            </div>
          )}
          {reply && (
            <div className="mt-1 text-primary">
              <span className="hud-label mr-2">eye</span>
              {reply}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
