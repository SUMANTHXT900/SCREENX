/**
 * Capture status store — active capture progress + last result (plan: state/useCaptureStore.ts).
 * Per-context (popup / editor); the SW broadcasts progress via messaging.
 */
import { create } from "zustand";
import type { CaptureResult, CaptureErrorCode } from "@/types/capture";

export type CapturePhase = "idle" | "capturing";

export interface CaptureProgress {
  mode: string;
  stage: string;
  percent: number;
  currentChunk: number;
  totalChunks: number;
}

interface CaptureStore {
  phase: CapturePhase;
  progress: CaptureProgress | null;
  lastResult: CaptureResult | null;
  lastError: { code: CaptureErrorCode; message: string } | null;
  setProgress: (p: CaptureProgress) => void;
  setResult: (r: CaptureResult) => void;
  setError: (code: CaptureErrorCode, message: string) => void;
  reset: () => void;
}

export const useCaptureStore = create<CaptureStore>()((set) => ({
  phase: "idle",
  progress: null,
  lastResult: null,
  lastError: null,
  setProgress: (p) =>
    set({ phase: "capturing", progress: p, lastError: null }),
  setResult: (r) =>
    set({ phase: "idle", progress: null, lastResult: r, lastError: null }),
  setError: (code, message) =>
    set({ phase: "idle", progress: null, lastError: { code, message } }),
  reset: () => set({ phase: "idle", progress: null, lastError: null }),
}));
