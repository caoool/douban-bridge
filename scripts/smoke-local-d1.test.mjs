import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPlatformProxy } from "wrangler";
import { localD1Config, withSmokeD1 } from "./smoke-local-d1.mjs";

const coreConfig = {
  name: "core-test",
  compatibility_date: "2025-11-28",
  account_id: "not-inherited",
  ai: { binding: "AI" },
  d1_databases: [
    { binding: "UNRELATED", database_name: "other", database_id: "other" },
    {
      binding: "STREMIO_ADDON_DOUBAN",
      database_name: "fork-local-test",
      database_id: "00000000-0000-0000-0000-000000000021",
      remote: true,
    },
  ],
};

test("smoke uses the configured D1 identity and never copies remote bindings", () => {
  const local = localD1Config(coreConfig);
  assert.deepEqual(local.d1_databases, [{ ...coreConfig.d1_databases[1], remote: false }]);
  assert.equal(local.name, "douban-bridge-smoke-d1");
  assert.equal(local.compatibility_date, coreConfig.compatibility_date);
  assert.equal("account_id" in local, false);
  assert.equal("ai" in local, false);
  assert.throws(() => localD1Config({ d1_databases: [] }), /must define STREMIO_ADDON_DOUBAN/);
});

test("smoke fixture data is readable by a different worker using the core database ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-smoke-d1-test-"));
  const persistPath = join(dir, "persist");
  let platform;
  try {
    await withSmokeD1(coreConfig, persistPath, async (db) => {
      await db.exec("CREATE TABLE probe (value TEXT); INSERT INTO probe VALUES ('shared fixture');");
    });
    const configPath = join(dir, "wrangler.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        name: "independent-core-test",
        compatibility_date: coreConfig.compatibility_date,
        d1_databases: [{ ...coreConfig.d1_databases[1], remote: false }],
      }),
    );
    platform = await getPlatformProxy({ configPath, persist: { path: persistPath }, remoteBindings: false });
    const row = await platform.env.STREMIO_ADDON_DOUBAN.prepare("SELECT value FROM probe").first();
    assert.equal(row.value, "shared fixture");
  } finally {
    try {
      await platform?.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
