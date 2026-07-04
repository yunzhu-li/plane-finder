import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const desktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function portalProxy(target: string, pathPrefix: string) {
  return {
    target,
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(new RegExp(`^${pathPrefix}`), "") || "/",
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("User-Agent", desktopUserAgent);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact()],
  server: {
    proxy: {
      "/portal/niceair": portalProxy("https://niceair.paperlessfbo.com", "/portal/niceair"),
      "/portal/squadron2": portalProxy("https://scheduler.squadron2.com", "/portal/squadron2"),
      "/portal/advantage": portalProxy("https://advantage.paperlessfbo.com", "/portal/advantage"),
      "/portal/aerodynamic": portalProxy("https://aerod.paperlessfbo.com", "/portal/aerodynamic"),
    },
  },
});
