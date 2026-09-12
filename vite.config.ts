import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "enforce-classic-content",
      generateBundle(_options, bundle) {
        // content.js is injected via chrome.scripting.executeScript, which
        // loads it as a CLASSIC script. Any static `import` (from Rollup
        // code-splitting a module shared with other entries) throws
        // "SyntaxError: Cannot use import statement outside a module" on
        // load and silently disables all capture. Background is type:module
        // so chunks are fine there — this guard covers content.js only.
        for (const [fileName, chunk] of Object.entries(bundle)) {
          if (fileName !== "content.js" || chunk.type !== "chunk") continue;
          // All static import forms: side-effect (`import"./x"`), named,
          // namespace, and default. `import.meta` intentionally excluded
          // (valid metadata access, Vite-resolvable — not a module split).
          if (/(^|[;\n}])\s*import(?=\s*["'{*]|\s+[A-Za-z_$])/.test(chunk.code)) {
            throw new Error(
              "[enforce-classic-content] dist/content.js contains a static import statement. " +
                "A module shared with another entry is being code-split into it. " +
                "Keep content code self-contained under src/content (see tests/content-bundle.test.ts)."
            );
          }
        }
      },
    },
    {
      name: "copy-manifest",
      closeBundle() {
        const srcManifest = resolve(__dirname, "src/manifest.json");
        const distManifest = resolve(__dirname, "dist/manifest.json");
        if (existsSync(srcManifest)) {
          // Vite already cleans dist; ensure copy after build
          const raw = readFileSync(srcManifest, "utf-8");
          // Validate JSON
          JSON.parse(raw);
          writeFileSync(distManifest, raw);
          // console.log("[copy-manifest] copied");
        }
        // Copy icons if present
        const iconsSrcDir = resolve(__dirname, "public/icons");
        const iconsDistDir = resolve(__dirname, "dist/icons");
        if (existsSync(iconsSrcDir)) {
          mkdirSync(iconsDistDir, { recursive: true });
          for (const file of readdirSync(iconsSrcDir)) {
            copyFileSync(resolve(iconsSrcDir, file), resolve(iconsDistDir, file));
          }
        } else {
          mkdirSync(iconsDistDir, { recursive: true });
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        editor: resolve(__dirname, "editor.html"),
        workspace: resolve(__dirname, "workspace.html"),
        history: resolve(__dirname, "history.html"),
        background: resolve(__dirname, "src/background/index.ts"),
        content: resolve(__dirname, "src/content/index.ts"),
      },
      output: {
        // Keep predictable filenames for extension entrypoints
        entryFileNames: (chunk) => {
          // background and content must match manifest
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  // Disable publicDir copy conflicts — we handle manifest/icons manually
  publicDir: "public",
});
