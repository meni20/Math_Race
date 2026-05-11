import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    assetsInclude: ["**/*.glb"],
    define: {
        global: "globalThis"
    },
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        port: 5173
    }
});
