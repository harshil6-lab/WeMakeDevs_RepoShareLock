#!/usr/bin/env node
/**
 * Builds the deployable AWS Lambda package.
 *
 * 1. Builds the SSR/API server with Nitro's `aws-lambda` preset into
 *    `.output-aws` (the default `vite.config.ts` is untouched).
 * 2. Bundles `src/aws/lambda-handler.ts`, which serves HTTP through the Nitro
 *    output and runs asynchronous self-invocations (investigation / indexing).
 * 3. Assembles `dist-lambda/` with the handler at the root and the Nitro server
 *    bundle under `server/`, ready to be zipped and uploaded.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverOutput = join(root, ".output-aws", "server");
const packageDir = join(root, "dist-lambda");

function run(scriptPath, args) {
  // Node refuses to spawn `.cmd` shims directly (EINVAL), and going through a
  // shell would re-parse arguments. Run the tool's JS entry with the current
  // Node executable instead, which is shell-free and portable.
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`${scriptPath} ${args.join(" ")} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

run(join(root, "node_modules", "vite", "bin", "vite.js"), [
  "build",
  "--config",
  "vite.config.aws.ts",
]);

rmSync(packageDir, { recursive: true, force: true });
mkdirSync(packageDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src", "aws", "lambda-handler.ts")],
  outfile: join(packageDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  logLevel: "info",
  banner: {
    js: 'import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);',
  },
});

if (!existsSync(serverOutput)) {
  console.error(`Nitro server output was not produced at ${serverOutput}`);
  process.exit(1);
}
cpSync(serverOutput, join(packageDir, "server"), { recursive: true });

console.log(`Lambda package written to ${packageDir}`);
