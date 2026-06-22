import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    assetsInclude: ["**/*.glb"],
    build: {
        outDir: process.env.VERCEL === "1" ? "dist" : "../public",
        emptyOutDir: true
    },
    define: {
        global: "globalThis"
    },
    plugins: [react()],
    server: {
        host: "0.0.0.0",
        port: 5173
    }
});
