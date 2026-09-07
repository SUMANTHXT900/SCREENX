/**
 * Settings store — user preferences persisted to chrome.storage.local
 * (plan: state/useSettingsStore.ts).
 */
import { create } from "zustand";

export type ExportFormat = "png" | "jpeg" | "webp";

interface SettingsStore {
  exportFormat: ExportFormat;
  exportQuality: number;
  ready: boolean;
  load: () => Promise<void>;
  setExportFormat: (f: ExportFormat) => void;
  setExportQuality: (q: number) => void;
}

const KEY = "screenx:settings";

function readStored(): Promise<Partial<Pick<SettingsStore, "exportFormat" | "exportQuality">>> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(KEY, (res) => {
          void chrome.runtime.lastError;
          resolve((res as Record<string, unknown>)[KEY] as Record<string, never> ?? {});
        });
        return;
      }
    } catch {
      // ignore
    }
    try {
      const raw = window.localStorage.getItem(KEY);
      resolve(raw ? (JSON.parse(raw) as Record<string, never>) : {});
    } catch {
      resolve({});
    }
  });
}

function writeStored(patch: Record<string, unknown>): void {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [KEY]: patch }, () => {
        void chrome.runtime.lastError;
      });
      return;
    }
  } catch {
    // ignore
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(patch));
  } catch {
    // ignore
  }
}

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  exportFormat: "png",
  exportQuality: 0.92,
  ready: false,
  load: async () => {
    const s = await readStored();
    set({
      exportFormat: s.exportFormat === "jpeg" || s.exportFormat === "webp" ? s.exportFormat : "png",
      exportQuality: typeof s.exportQuality === "number" ? Math.min(1, Math.max(0.5, s.exportQuality)) : 0.92,
      ready: true,
    });
  },
  setExportFormat: (f) => {
    set({ exportFormat: f });
    const { exportQuality } = get();
    writeStored({ exportFormat: f, exportQuality });
  },
  setExportQuality: (q) => {
    const v = Math.min(1, Math.max(0.5, q));
    set({ exportQuality: v });
    const { exportFormat } = get();
    writeStored({ exportFormat, exportQuality: v });
  },
}));
