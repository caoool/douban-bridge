import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsDir = new URL("../drizzle/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));

test("checked-in migrations initialize an empty database without uncommenting SQL", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const sql of migrations) db.exec(sql);

  db.exec(`
    INSERT INTO users (id, github_id, github_login) VALUES ('new-user', 1, 'new-user');
    INSERT INTO user_configs (user_id, catalog_ids) VALUES ('new-user', '["movie_top250"]');
    INSERT INTO api_keys (user_id, key, created_at) VALUES ('new-user', 'sk_local_test', 1);
    INSERT INTO douban_mapping (douban_id, imdb_id, agent, deleted_at)
      VALUES (1291546, 'tt0111161', '{"status":"suggested"}', NULL);
    INSERT INTO pi_token_usage (day, model, input, output, cache_read, cache_write, messages, cost_micro)
      VALUES ('2026-10-27', 'local-test', 1, 2, 0, 0, 1, 0);
  `);
  assert.equal(db.prepare("SELECT key FROM api_keys WHERE user_id = ?").get("new-user").key, "sk_local_test");
  assert.equal(db.prepare("SELECT imdb_id FROM douban_mapping WHERE douban_id = ?").get(1291546).imdb_id, "tt0111161");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("the baseline is repeatable and legacy data survives the remaining migrations", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(migrations[0]);
  db.exec(`
    INSERT INTO users (id, github_id, github_login, github_access_token)
      VALUES ('legacy-user', 2, 'legacy-user', 'local-test-token');
    INSERT INTO user_configs (user_id, catalog_ids, dynamic_collections)
      VALUES ('legacy-user', '["movie_top250"]', 1);
    INSERT INTO douban_mapping (douban_id, tmdb_id, imdb_id, calibrated)
      VALUES (1291546, 278, 'tt0111161', 1);
  `);
  db.exec(migrations[0]);
  for (const sql of migrations.slice(1)) db.exec(sql);
  db.exec("INSERT INTO api_keys (user_id, key, created_at) VALUES ('legacy-user', 'sk_preserved', 1)");
  db.exec(migrations[0]);

  assert.equal(
    db.prepare("SELECT github_access_token FROM users WHERE id = ?").get("legacy-user").github_access_token,
    "local-test-token",
  );
  assert.equal(
    db.prepare("SELECT dynamic_collections FROM user_configs WHERE user_id = ?").get("legacy-user").dynamic_collections,
    1,
  );
  assert.equal(
    db.prepare("SELECT catalog_ids FROM user_configs WHERE user_id = ?").get("legacy-user").catalog_ids,
    '["movie_top250"]',
  );
  assert.equal(db.prepare("SELECT calibrated FROM douban_mapping WHERE douban_id = ?").get(1291546).calibrated, 1);
  assert.equal(db.prepare("SELECT key FROM api_keys WHERE user_id = ?").get("legacy-user").key, "sk_preserved");
  assert.equal(
    db
      .prepare("PRAGMA table_info(user_configs)")
      .all()
      .some((column) => column.name === "fanart_enabled"),
    false,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
