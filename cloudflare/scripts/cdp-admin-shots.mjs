import fs from "node:fs";

const [, , base, prefix, scheme = "light"] = process.argv;
if (!base || !prefix) {
  console.error("usage: node scripts/cdp-admin-shots.mjs <base> <prefix> [light|dark]");
  process.exit(1);
}
const isWorker = base.includes("workers.dev");
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));
const email = isWorker ? creds.admin.email : "admin@meohay.local";
const password = isWorker ? creds.admin.password : "M2-Baseline-Password-1";
const list = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = list.find((item) => item.type === "page");
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 1000,
});

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result?.value;
}

async function shot(name) {
  const metrics = await send("Page.getLayoutMetrics");
  const size = metrics.cssContentSize || metrics.contentSize;
  const data = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: Math.min(6000, Math.ceil(size.height)), scale: 1 },
  });
  const file = `screenshots-m2/${prefix}-${name}.png`;
  fs.writeFileSync(file, Buffer.from(data.data, "base64"));
  console.log(file, Math.ceil(size.height));
}

await send("Page.navigate", { url: `${base}/admin/login` });
await wait(2500);
await shot("login");
const submitted = await evaluate(`(() => {
  const email = document.querySelector('#email');
  const password = document.querySelector('#password');
  if (!email || !password) return false;
  email.value = ${JSON.stringify(email)};
  password.value = ${JSON.stringify(password)};
  email.dispatchEvent(new Event('input', { bubbles: true }));
  password.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('form').requestSubmit();
  return true;
})()`);
if (!submitted) throw new Error("login form not found");
await wait(4000);
console.log("after login", await evaluate("location.pathname"));
await shot("dashboard");

await send("Page.navigate", { url: `${base}/admin/posts` });
await wait(2500);
await shot("posts");
const editPath = await evaluate(`(() => {
  const link = [...document.querySelectorAll('a[href*="/admin/posts/"]')].find((item) => /\\/admin\\/posts\\/[^/]+\\/edit/.test(item.getAttribute('href')));
  return link ? link.getAttribute('href') : '';
})()`);
if (editPath) {
  await send("Page.navigate", { url: base + editPath });
  await wait(2500);
  await shot("editor");
}

await send("Page.navigate", { url: `${base}/admin` });
await wait(2000);
await send("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844,
});
await wait(1000);
const metrics = await send("Page.getLayoutMetrics");
const size = metrics.cssContentSize || metrics.contentSize;
const mobile = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: 390, height: Math.min(5000, Math.ceil(size.height)), scale: 1 },
});
fs.writeFileSync(`screenshots-m2/${prefix}-mobile-dashboard.png`, Buffer.from(mobile.data, "base64"));
console.log(`screenshots-m2/${prefix}-mobile-dashboard.png`, Math.ceil(size.height));
socket.close();
