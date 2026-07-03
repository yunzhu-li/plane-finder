import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  base: "./",
  plugins: [preact()],
  server: {
    proxy: {
      "/portal/niceair": {
        target: "https://niceair.paperlessfbo.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/portal\/niceair/, "") || "/",
      },
    },
  },
});
