import fs from "node:fs";

const [, , url, widthArg = "390", scheme = "dark"] = process.argv;
const width = Number(widthArg);
const list = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = list.find((item) => item.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
const events = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else if (message.method) {
    events.push(message);
  }
});
function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send("Page.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height: 844,
  deviceScaleFactor: 1,
  mobile: width < 600,
  screenWidth: width,
  screenHeight: 844,
});
await send("Page.navigate", { url });
await new Promise((resolve) => setTimeout(resolve, 5000));
const evaluated = await send("Runtime.evaluate", {
  expression: `(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.getAttribute("data-theme"),
    bg: getComputedStyle(document.body).backgroundColor,
    heroSlides: document.querySelectorAll(".hero-slide").length,
    activeSlides: document.querySelectorAll(".hero-slide.active").length,
    ticker: document.querySelector(".ticker-title")?.textContent?.trim() || null,
    navLinks: document.querySelectorAll(".navlinks a").length,
    sidebarWidgets: document.querySelectorAll(".widget").length,
    brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length,
    images: document.images.length,
    h1: document.querySelectorAll("h1").length,
    title: document.title,
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)["@type"]; } catch { return "invalid"; } }),
  }))()`,
  returnByValue: true,
});
const failures = events
  .filter((event) => event.method === "Network.loadingFailed")
  .map((event) => ({ url: event.params?.requestId, error: event.params?.errorText }));
const httpErrors = events
  .filter((event) => event.method === "Network.responseReceived" && event.params.response.status >= 400)
  .map((event) => ({ url: event.params.response.url, status: event.params.response.status }));
const exceptions = events
  .filter((event) => event.method === "Runtime.exceptionThrown")
  .map((event) => event.params.exceptionDetails.text);
const consoleErrors = events
  .filter((event) => event.method === "Runtime.consoleAPICalled" && event.params.type === "error")
  .map((event) => event.params.args.map((arg) => arg.value || arg.description).join(" "));
const output = { url, width, scheme, dom: evaluated.result.value, failures, httpErrors, exceptions, consoleErrors };
fs.writeFileSync(`fixtures/cdp-audit-${width}.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
socket.close();
