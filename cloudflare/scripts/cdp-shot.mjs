import fs from "node:fs";

const [, , url, widthArg, heightArg, outFile, scheme = "light"] = process.argv;
const width = Number(widthArg || 390);
const height = Number(heightArg || 844);
if (!url || !outFile) {
  console.error("usage: node scripts/cdp-shot.mjs <url> <width> <height> <out.png> [light|dark]");
  process.exit(1);
}

const list = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = list.find((item) => item.type === "page");
if (!page) throw new Error("No CDP page found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 600,
  screenWidth: width,
  screenHeight: height,
});
await send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: scheme }],
});
await send("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, 4000));
const metrics = await send("Page.getLayoutMetrics");
const size = metrics.cssContentSize || metrics.contentSize;
const shot = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: {
    x: 0,
    y: 0,
    width: Math.min(width, Math.ceil(size.width)),
    height: Math.min(16000, Math.ceil(size.height)),
    scale: 1,
  },
});
fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
console.log(JSON.stringify({ outFile, width, height, scheme, contentHeight: size.height }));
socket.close();
