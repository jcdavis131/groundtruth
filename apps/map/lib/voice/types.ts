export type VoiceStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "unsupported";

export interface VoiceSessionHandlers {
  onStatus: (s: VoiceStatus) => void;
  onTranscript: (text: string, final: boolean) => void;
  onReply: (text: string) => void;
  onError: (message: string) => void;
}

export interface VoiceSession {
  stop: () => void;
}
