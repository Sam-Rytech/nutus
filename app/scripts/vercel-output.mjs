// Packs the built site and the Telegram bot's two functions into Vercel's
// Build Output API layout (.vercel/output), for `vercel deploy --prebuilt`.
// We bundle the functions ourselves because they import workspace packages
// written in TypeScript, which Vercel's own builder won't compile.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(app, ".vercel", "output");
rmSync(out, { recursive: true, force: true });

cpSync(join(app, "dist"), join(out, "static"), { recursive: true, filter: (p) => !p.endsWith("vercel.json") });

for (const name of ["telegram", "tick"]) {
  const dir = join(out, "functions", "api", `${name}.func`);
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [join(app, "..", "packages", "notify", "src", "vercel", `${name}.ts`)],
    outfile: join(dir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  writeFileSync(
    join(dir, ".vc-config.json"),
    JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }),
  );
}

writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/assets/(.*)", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        { src: "/api/(.*)", status: 404 },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`wrote ${out}`);
