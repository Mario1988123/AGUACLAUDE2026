import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Config mínima para los tests unitarios de lógica pura (sin BD).
// El alias @ replica el paths de tsconfig para poder importar desde @/...
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
  },
});
