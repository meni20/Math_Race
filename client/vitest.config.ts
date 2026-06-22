import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.glb"],
  test: {
    include: ["scripts/run-static-tests.ts"]
  }
});
