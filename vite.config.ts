/**
 * Two builds from one config:
 *
 *   vite build                 -> dist/: the site, with an offline worker
 *   vite build --mode single   -> dist/storyboard.html: the whole app in one file,
 *                                 which runs straight from disk
 *
 * `npm run build` runs both, the site first (it empties dist/). Every path is
 * relative (base "./"), so the site works at whatever address it is served from.
 */

import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";

/** The single build's page is storyboard.html, beside the site, not over its index. */
const renameSingle = (): Plugin => ({
  name: "storyboard:single-name",
  enforce: "post",
  generateBundle(_, bundle) {
    const page = bundle["index.html"];
    if (page) page.fileName = "storyboard.html";
  },
});

export default defineConfig(({ mode }) => {
  const single = mode === "single";
  return {
    base: "./",
    plugins: single
      ? [svelte(), viteSingleFile(), renameSingle()]
      : [
          svelte(),
          VitePWA({
            registerType: "autoUpdate",
            injectRegister: "script",
            manifest: {
              name: "Storyboard",
              short_name: "Storyboard",
              description: "A writing page for solo roleplaying games",
              start_url: ".",
              scope: ".",
              display: "standalone",
              background_color: "#f7f6f3",
              theme_color: "#f7f6f3",
              icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
            },
            workbox: {
              // Every cache this worker makes is named "storyboard-…", and old
              // ones are cleared only within its own scope, so Orangey's caches
              // on the same site are never touched (and Orangey leaves these alone).
              cacheId: "storyboard",
              cleanupOutdatedCaches: true,
              globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
            },
          }),
        ],
    // The editor and the roll engine come to about 450 kB; one file is fine for
    // an app that is cached after the first visit, so Vite need not warn about it.
    build: single
      ? { outDir: "dist", emptyOutDir: false, copyPublicDir: false, chunkSizeWarningLimit: 1000 }
      : { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  };
});
