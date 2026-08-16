#!/usr/bin/env node

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.INSTA_WEB_PORT || 3000);
const distRoot = path.resolve(process.env.INSTA_WEB_DIST || path.join(import.meta.dirname, "../web-dist"));
const clientRoot = path.join(distRoot, "client");
const workerPath = path.join(distRoot, "server", "index.js");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

function safeAssetPath(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  } catch {
    return null;
  }
  const candidate = path.resolve(clientRoot, `.${pathname}`);
  return candidate === clientRoot || candidate.startsWith(`${clientRoot}${path.sep}`) ? candidate : null;
}

async function fetchAsset(request) {
  const filename = safeAssetPath(request.url);
  if (!filename || !existsSync(filename) || !statSync(filename).isFile()) {
    return new Response("Not found", { status: 404 });
  }
  const data = await import("node:fs/promises").then(({ readFile }) => readFile(filename));
  return new Response(data, {
    headers: {
      "Content-Type": mimeTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
      "Cache-Control": filename.includes(`${path.sep}assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

const { default: worker } = await import(pathToFileURL(workerPath).href);
const env = { ASSETS: { fetch: fetchAsset } };
const context = { waitUntil() {}, passThroughOnException() {} };

function serveStaticAsset(incoming, outgoing) {
  const filename = safeAssetPath(incoming.url || "/");
  if (!filename || !existsSync(filename) || !statSync(filename).isFile()) return false;

  outgoing.statusCode = 200;
  outgoing.setHeader(
    "Content-Type",
    mimeTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
  );
  outgoing.setHeader(
    "Cache-Control",
    filename.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  outgoing.setHeader("Content-Length", String(statSync(filename).size));
  if ((incoming.method || "GET") === "HEAD") outgoing.end();
  else createReadStream(filename).pipe(outgoing);
  return true;
}

const server = http.createServer(async (incoming, outgoing) => {
  try {
    // vinext's production worker delegates static files to a hosting binding.
    // A desktop bundle has no such platform, so serve packaged client assets
    // before passing application routes to the worker.
    if (serveStaticAsset(incoming, outgoing)) return;

    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const requestUrl = new URL(incoming.url || "/", `http://localhost:${port}`);
    const method = incoming.method || "GET";
    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD") {
      init.body = Readable.toWeb(incoming);
      init.duplex = "half";
    }
    const response = await worker.fetch(new Request(requestUrl, init), env, context);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    if (!response.body || method === "HEAD") {
      outgoing.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("Content-Type", "text/plain; charset=utf-8");
    outgoing.end(`Insta Library web error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Insta Library Web: http://localhost:${port}/\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
