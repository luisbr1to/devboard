import react from "@vitejs/plugin-react";
import fs from "fs";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/tabs/home/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        auth: "auth.html",
        teamsAuth: "teams-auth.html",
      },
    },
  },
  esbuild: {
    tsconfigRaw: fs.readFileSync("./tsconfig.app.json"),
  },
});
