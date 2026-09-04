import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest does not read tsconfig `paths`, so the `@/` alias is repeated here.
// Without it every import of `@/db/schema` fails to resolve under test.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
