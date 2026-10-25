import fs from "node:fs";

const input = process.argv[2] || "fixtures/seed.sql";
const outDir = process.argv[3] || "fixtures/split";
const chunkSize = Number(process.argv[4]) || 100;

const lines = fs
  .readFileSync(input, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = [];
for (let index = 0; index < lines.length; index += chunkSize) {
  const name = `part-${String(index / chunkSize + 1).padStart(3, "0")}.sql`;
  const content = `${lines.slice(index, index + chunkSize).join("\n")}\n`;
  fs.writeFileSync(`${outDir}/${name}`, content);
  files.push({ name, statements: Math.min(chunkSize, lines.length - index) });
}
console.log(JSON.stringify({ input, statements: lines.length, files }, null, 2));
