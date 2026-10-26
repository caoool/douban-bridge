import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";

export function localD1Config(coreConfig) {
  const binding = coreConfig.d1_databases?.find((item) => item.binding === "STREMIO_ADDON_DOUBAN");
  if (!binding?.database_id || !binding.database_name) {
    throw new Error("Core config must define STREMIO_ADDON_DOUBAN with a database_name and database_id");
  }
  return {
    name: "douban-bridge-smoke-d1",
    compatibility_date: coreConfig.compatibility_date,
    d1_databases: [
      {
        binding: "STREMIO_ADDON_DOUBAN",
        database_name: binding.database_name,
        database_id: binding.database_id,
        remote: false,
      },
    ],
  };
}

export async function withSmokeD1(coreConfig, persistPath, run) {
  const config = localD1Config(coreConfig);
  const dir = mkdtempSync(join(tmpdir(), "bridge-smoke-d1-"));
  let platform;
  try {
    const configPath = join(dir, "wrangler.json");
    writeFileSync(configPath, JSON.stringify(config));
    platform = await getPlatformProxy({
      configPath,
      persist: { path: persistPath },
      remoteBindings: false,
    });
    return await run(platform.env.STREMIO_ADDON_DOUBAN);
  } finally {
    try {
      await platform?.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
