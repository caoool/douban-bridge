import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const widgetRoot = new URL("../apps/rex-widget/", import.meta.url);
const build = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("node_modules/@rslib/core/bin/rslib.js", widgetRoot)), "build"],
  {
    cwd: fileURLToPath(widgetRoot),
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "inherit",
  },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const assetDirectory = new URL("../apps/core/public/widget/", import.meta.url);
await mkdir(assetDirectory, { recursive: true });
await copyFile(new URL("dist/douban-bridge.js", widgetRoot), new URL("douban.js", assetDirectory));
console.info("Rex widget prepared at /widget/douban.js");
