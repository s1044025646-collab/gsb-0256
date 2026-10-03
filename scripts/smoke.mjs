import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/cli.js", "serve"], { stdio: ["ignore", "pipe", "inherit"] });
const port = await new Promise((resolve, reject) => {
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
    if (m) resolve(Number(m[1]));
  });
  child.on("exit", () => reject(new Error("server exited")));
  setTimeout(() => reject(new Error("timeout")), 10000);
});
console.log("port:", port);

const r1 = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ base: "http://a/b/c/d;p?q", reference: "?y" }),
});
console.log("single:", r1.status, (await r1.json()).uri);

const r2 = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    items: [
      { base: "http://a/b/c/d;p?q", reference: "g" },
      { base: "bad", reference: "g" },
      { base: "http://a/b/c/d;p?q", reference: "#s" },
    ],
  }),
});
const batch = await r2.json();
console.log("batch:", r2.status, JSON.stringify(batch.results.map((x) => ({ i: x.index, ok: x.ok, uri: x.uri, err: x.error?.code }))));

const r3 = await fetch(`http://127.0.0.1:${port}/api/history?limit=3`);
console.log("history:", r3.status, (await r3.json()).items.length, "rows");

child.stdout.destroy();
child.on("exit", () => setTimeout(() => process.exit(0), 100));
child.kill();
