import { defineConfig } from "vite";

export default defineConfig({
  base: "/ids-validator/",
  build: {
    outDir: "dist",
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["web-ifc"],
  },
});
