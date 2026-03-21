/**
 * copy-wasm.js — Copie les fichiers WASM et le Worker Fragments vers /public (racine)
 * Exécuté automatiquement après npm install
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ── 1. Fichiers WASM web-ifc → public/ (racine) ──────────
const wasmSrc  = join(root, "node_modules", "web-ifc");
const wasmDest = join(root, "public");

if (!existsSync(wasmSrc)) {
  console.warn("[copy-wasm] web-ifc non trouvé dans node_modules, ignoré.");
} else {
  mkdirSync(wasmDest, { recursive: true });
  const wasmFiles = readdirSync(wasmSrc).filter(
    (f) => f.endsWith(".wasm") || (f.endsWith(".js") && f.includes("web-ifc"))
  );
  for (const file of wasmFiles) {
    copyFileSync(join(wasmSrc, file), join(wasmDest, file));
    console.log(`[copy-wasm] Copié WASM : ${file}`);
  }
  console.log(`[copy-wasm] WASM OK — ${wasmFiles.length} fichier(s) dans public/`);
}

console.log("[copy-wasm] Done.");
