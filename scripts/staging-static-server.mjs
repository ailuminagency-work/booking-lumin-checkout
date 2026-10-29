import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appPath = process.argv[2];
const port = Number(process.argv[3] || process.env.PORT || 8080);
if (!appPath) throw new Error("Usage: node scripts/staging-static-server.mjs <app-path> [port]");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), appPath, "dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  const candidate = resolve(root, `.${normalize(pathname)}`);
  const safeCandidate = candidate.startsWith(root) ? candidate : root;
  const file = existsSync(safeCandidate) && statSync(safeCandidate).isFile() ? safeCandidate : join(root, "index.html");
  if (!existsSync(file)) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("staging build unavailable");
    return;
  }
  response.writeHead(200, { "cache-control": "no-cache", "content-type": contentTypes[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(port, "0.0.0.0", () => console.log(`staging static server listening on ${port}`));
