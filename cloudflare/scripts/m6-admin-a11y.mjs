import fs from "node:fs";

const BASE = "https://meohay-m0-stg-230403.poseidonxx001.workers.dev";
const creds = JSON.parse(fs.readFileSync("fixtures/.m2-passwords.json", "utf8"));

const loginPage = await fetch(`${BASE}/admin/login`, { headers: { "user-agent": "Mozilla/5.0 M6-A11y" }, signal: AbortSignal.timeout(30_000) });
const cookies = loginPage.headers.getSetCookie?.() || [];
const csrf = /name="_csrf" value="([^"]+)"/.exec(await loginPage.text())?.[1];
const cookieHeader = cookies.map((item) => item.split(";")[0]).join("; ");
const login = await fetch(`${BASE}/admin/login`, {
  method: "POST",
  headers: {
    "user-agent": "Mozilla/5.0 M6-A11y",
    cookie: cookieHeader,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ _csrf: csrf, email: creds.admin.email, password: creds.admin.password }),
  redirect: "manual",
  signal: AbortSignal.timeout(30_000),
});
console.log("login", login.status);
const sessionCookie = (login.headers.getSetCookie?.() || []).find((item) => item.startsWith("mh_session="));
if (!sessionCookie) throw new Error(`login failed: ${login.status}`);
const session = sessionCookie.split(";")[0];
const token = session.slice("mh_session=".length);

const list = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const page = list.find((item) => item.type === "page");
if (!page) throw new Error("No CDP page");
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
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setCookie", {
  name: "mh_session",
  value: token,
  domain: "meohay-m0-stg-230403.poseidonxx001.workers.dev",
  path: "/",
  secure: true,
  httpOnly: true,
});

const pages = ["/admin", "/admin/posts", "/admin/posts/new", "/admin/media"];
const result = [];
for (const path of pages) {
  console.log("navigate", path);
  await send("Page.navigate", { url: BASE + path });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const evaluated = await send("Runtime.evaluate", {
    expression: `(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(visible);
      const unlabeled = fields.filter((el) => {
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
        if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
        if (el.closest('label')) return false;
        if (el.type === 'checkbox' || el.type === 'radio') return !el.closest('label');
        return true;
      }).map((el) => el.id || el.name || el.outerHTML.slice(0, 80));
      const images = [...document.images].filter(visible);
      const noAlt = images.filter((img) => !img.hasAttribute('alt')).map((img) => img.src);
      const controls = [...document.querySelectorAll('button,a')].filter(visible);
      const noName = controls.filter((el) => !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')).map((el) => el.outerHTML.slice(0, 100));
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => Number(h.tagName[1]));
      let order = true;
      for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i-1] + 1) order = false;
      return {
        path: location.pathname,
        title: document.title,
        h1: document.querySelectorAll('h1').length,
        main: !!document.querySelector('main'),
        skip: !!document.querySelector('.skip-link'),
        fields: fields.length,
        unlabeled,
        images: images.length,
        noAlt,
        controls: controls.length,
        noName,
        headingOrder: order,
      };
    })()`,
    returnByValue: true,
  });
  result.push(evaluated.result.value);
}
fs.writeFileSync("fixtures/m6-admin-a11y.json", JSON.stringify(result, null, 2));
for (const item of result) {
  const issues = item.unlabeled.length + item.noAlt.length + item.noName.length + (item.h1 ? 0 : 1) + (item.main ? 0 : 1) + (item.headingOrder ? 0 : 1);
  console.log(`${item.path}: issues=${issues} fields=${item.fields} unlabeled=${item.unlabeled.length} images=${item.images} noAlt=${item.noAlt.length} controls=${item.controls} noName=${item.noName.length} h1=${item.h1} main=${item.main} order=${item.headingOrder}`);
  if (item.unlabeled.length) console.log("  unlabeled:", item.unlabeled.slice(0, 5));
  if (item.noAlt.length) console.log("  noAlt:", item.noAlt.slice(0, 5));
  if (item.noName.length) console.log("  noName:", item.noName.slice(0, 5));
}
process.exitCode = result.some((item) => item.unlabeled.length || item.noAlt.length || item.noName.length || !item.h1 || !item.main || !item.headingOrder) ? 1 : 0;
