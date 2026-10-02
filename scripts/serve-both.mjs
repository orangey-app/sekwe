/**
 * Serves Orangey and Sekwe side by side from one local address, so they
 * share the browser's storage the way they will when published together:
 *
 *   http://127.0.0.1:4321/orangey/      ../orangey/dist   (npm run build there)
 *   http://127.0.0.1:4321/sekwe/   ./dist            (npm run build here)
 *
 *   node scripts/serve-both.mjs [--port 4321] [--orangey <folder>]
 *
 * Browsers keep each site's storage apart, and localhost:4173 and
 * localhost:5173 are two sites; that is why the two apps' own dev servers
 * cannot see each other's data, and why this exists.
 */

import { createServer } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(dirname(fileURLToPath(import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const INDEX = `<!doctype html><meta charset="utf-8"><title>Orangey and Sekwe</title>
<style>body{font:16px system-ui;margin:3rem auto;max-width:30rem;line-height:1.5}a{display:block;margin:.5rem 0}</style>
<h1>Local</h1><a href="orangey/">Orangey</a><a href="sekwe/">Sekwe</a>
<p>Both are served from this one address, so they share this browser's storage.</p>`;

/** One server, a folder per path prefix. A folder's address serves its index.html. */
export function serveBoth({ orangey, sekwe }) {
  const mounts = [
    ["/orangey/", orangey],
    ["/sekwe/", sekwe],
  ];
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);
    if (path === "/") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(INDEX);
      return;
    }
    for (const [prefix, dir] of mounts) {
      if (path === prefix.slice(0, -1)) {
        res.writeHead(301, { location: prefix });
        res.end();
        return;
      }
      if (!path.startsWith(prefix)) continue;
      let file = normalize(join(dir, path.slice(prefix.length)));
      // Nothing outside the folder, however the path is spelled.
      if (file !== dir && !file.startsWith(dir + sep)) break;
      if (path.endsWith("/") || (existsSync(file) && statSync(file).isDirectory())) file = join(file, "index.html");
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "content-length": String(body.length), "cache-control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : body);
      } catch {
        break;
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const port = Number(opt("--port", 4321));
  const orangey = resolve(opt("--orangey", join(here, "..", "orangey")), "dist");
  const sekwe = join(here, "dist");
  for (const [name, dir, how] of [
    ["Orangey", orangey, "run npm run build in the orangey folder"],
    ["Sekwe", sekwe, "run npm run build here"],
  ]) {
    if (!existsSync(join(dir, "index.html"))) console.warn(`${name} is not built at ${dir}: ${how}`);
  }
  serveBoth({ orangey, sekwe }).listen(port, "127.0.0.1", () => {
    console.log(`Orangey:    http://127.0.0.1:${port}/orangey/`);
    console.log(`Sekwe: http://127.0.0.1:${port}/sekwe/`);
    console.log("Ctrl+C to stop.");
  });
}
