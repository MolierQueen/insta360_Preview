import assert from "node:assert/strict";
import test from "node:test";

test("renders the Insta Library product shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Insta Library/);
  assert.match(html, /连接相机/);
  assert.match(html, /导入照片加水印/);
  assert.match(html, /只读/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
