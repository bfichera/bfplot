import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

async function run(command, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

async function copyFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, source), destination);
}

async function copyText(source, destination) {
  const text = await readFile(resolve(root, source), "utf8");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, text.replace(/[ \t]+$/gm, ""));
}

await run(resolve(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"]);
await copyFile("src/style.css", resolve(dist, "style.css"));
await copyFile("app/index.html", resolve(dist, "index.html"));

for (const font of ["500-roman", "500-italic", "700-roman"]) {
  await copyFile(
    `node_modules/computer-modern/fonts/cmu-serif-${font}.woff2`,
    resolve(dist, `fonts/cmu-serif-${font}.woff2`),
  );
}
await copyText("node_modules/computer-modern/OFL.txt", resolve(dist, "fonts/OFL.txt"));
await copyFile("node_modules/fzstd/esm/index.mjs", resolve(dist, "fzstd.js"));
await copyText("node_modules/temml/dist/temml.mjs", resolve(dist, "temml.js"));

const loaderPath = resolve(dist, "loader.js");
const loader = await readFile(loaderPath, "utf8");
await writeFile(loaderPath, loader.replace('from "fzstd"', 'from "./fzstd.js"'));

const mathPath = resolve(dist, "math.js");
const math = await readFile(mathPath, "utf8");
await writeFile(mathPath, math.replace('from "temml"', 'from "./temml.js"'));

// TypeScript may retain stale output for deleted source modules.
const sourceNames = new Set([
  "fzstd",
  "temml",
  ...(await readdir(resolve(root, "src")))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => name.slice(0, -3)),
]);
for (const entry of await readdir(dist)) {
  const match = /^(.*)\.(?:js|js\.map|d\.ts)$/.exec(entry);
  if (match && !sourceNames.has(match[1])) await rm(resolve(dist, entry));
}
