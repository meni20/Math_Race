import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        asphalt: {
          900: "#030712",
          800: "#0a0f1c",
          700: "#11172d"
        },
        neon: {
          cyan: "#28f6ff",
          amber: "#ffc543",
          coral: "#ff5468"
        }
      },
      boxShadow: {
        neon: "0 0 0.5rem rgba(40,246,255,0.65), 0 0 1.4rem rgba(40,246,255,0.28)"
      }
    }
  },
  plugins: []
};

export default config;
