"use client";
// Keyless voice control using the browser's built-in Web Speech API
// (Chrome, Edge, Safari). Nothing leaves the browser except the recogniser's
// own cloud round-trip, which the browser vendor performs.

import { parseIntent } from "./intent";
import { runCommand } from "./commands";
import type { VoiceSession, VoiceSessionHandlers } from "./types";

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function webSpeechSupported(): boolean {
  return ctor() != null;
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function startWebSpeech(h: VoiceSessionHandlers): VoiceSession {
  const Ctor = ctor();
  if (!Ctor) {
    h.onStatus("unsupported");
    return { stop: () => {} };
  }
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let stopped = false;

  rec.onstart = () => h.onStatus("listening");
  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) h.onTranscript(interim, false);
    if (final) {
      h.onTranscript(final, true);
      h.onStatus("thinking");
      const intent = parseIntent(final);
      if (!intent) {
        const msg = "I did not catch a command. Try: show me flights over Austin.";
        h.onReply(msg);
        speak(msg);
        h.onStatus("idle");
        return;
      }
      runCommand(intent.command, intent.args).then((reply) => {
        h.onReply(reply);
        speak(reply);
        h.onStatus("idle");
      });
    }
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") {
      h.onStatus("idle");
      return;
    }
    h.onError(`speech: ${e.error}`);
    h.onStatus("idle");
  };
  rec.onend = () => {
    if (!stopped) h.onStatus("idle");
  };
  try {
    rec.start();
  } catch (err) {
    h.onError(err instanceof Error ? err.message : String(err));
    h.onStatus("idle");
  }
  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      h.onStatus("idle");
    },
  };
}
