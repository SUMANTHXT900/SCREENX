/**
 * Capture engine registry — the seam that makes engines swappable
 * (plan: capture/engine/registry.ts).
 *
 * popup/background never import engine implementations directly; they call
 * capture(type), which dispatches through this registry. To replace an
 * engine (e.g. a native offscreen-document capturer, a test double), call
 * registerCaptureEngine() with the same CaptureType — no router edits needed:
 *
 *   import { registerCaptureEngine } from "@/capture/engine/registry";
 *   registerCaptureEngine("full-page", myCustomFullPage);
 */
import { CaptureError, type CaptureResult, type CaptureType } from "@/types/capture";

export type CaptureEngineRun = () => Promise<CaptureResult>;

export interface CaptureEngine {
  readonly type: CaptureType;
  readonly run: CaptureEngineRun;
}

const engines = new Map<CaptureType, CaptureEngineRun>();

export function registerCaptureEngine(type: CaptureType, run: CaptureEngineRun): void {
  engines.set(type, run);
}

export function getCaptureEngine(type: CaptureType): CaptureEngineRun | undefined {
  return engines.get(type);
}

export function listCaptureEngines(): CaptureType[] {
  return [...engines.keys()];
}

export function unregisterCaptureEngine(type: CaptureType): void {
  engines.delete(type);
}

/** Dispatch through the registry; unknown types throw UNSUPPORTED_TYPE. */
export async function runCaptureEngine(type: CaptureType): Promise<CaptureResult> {
  const run = engines.get(type);
  if (!run) {
    throw new CaptureError("UNSUPPORTED_TYPE", `Unknown capture type: ${String(type)}`);
  }
  return run();
}
