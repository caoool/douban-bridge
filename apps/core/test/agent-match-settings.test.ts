import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { eq } from "drizzle-orm";
import { scheduled } from "../src/cron";
import { doubanMapping } from "../src/db";
import { claimAgentJobs, persistAndEnqueueUnmatched } from "../src/libs/agent-match/pool";
import { handleAgentMatchBatch } from "../src/libs/agent-match/queue";
import { agentMatchRuntime, runAgentMatchJob } from "../src/libs/agent-match/runner";
import { isAgentMatchEnabled, isTokensReportEnabled } from "../src/libs/agent-match/settings";
import { reportPiUsage } from "../src/libs/agent-match/tokens-report";
import type { AgentMatchJob } from "../src/libs/agent-match/types";
import { api } from "../src/libs/api";
import { withTestContext } from "./context";

test("AI matching requires explicit opt-in before claims, enqueueing or direct execution", async () => {
  await withTestContext(async (env) => {
    const sent: AgentMatchJob[] = [];
    Object.assign(env, { AGENT_MATCH_QUEUE: { send: async (job: AgentMatchJob) => sent.push(job) } });
    await api.db.insert(doubanMapping).values({ doubanId: 101 });
    Reflect.deleteProperty(env, "AGENT_MATCH_ENABLED");
    for (const value of [undefined, false, "false", "", "TRUE", true, "true"]) {
      if (value !== undefined) Object.assign(env, { AGENT_MATCH_ENABLED: value });
      const enabled = value === true || value === "true";
      assert.equal(isAgentMatchEnabled(env), enabled);
      if (enabled) continue;
      assert.deepEqual(await claimAgentJobs(1, Date.now(), [101]), []);
      await persistAndEnqueueUnmatched([{ doubanId: 102, tmdbId: null, imdbId: null, traktId: null }]);
      assert.equal(await runAgentMatchJob({ doubanId: 101, agentToken: "unused" }), "disabled");
      await assert.rejects(
        agentMatchRuntime.runPiSession({ system: "", user: "", tools: [], sessionId: "disabled:101" }),
        /Agent matching is disabled/,
      );
    }
    assert.deepEqual(sent, []);
    const rows = await api.db.select().from(doubanMapping);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.agent == null));
    // Opting in restores the same claim path without deleting the saved work.
    assert.equal((await claimAgentJobs(1, Date.now(), [101])).length, 1);
  });
});

test("disabled queue consumer acknowledges old jobs without starting AI or changing their lease", async () => {
  await withTestContext(async (env, ctx) => {
    Object.assign(env, { AGENT_MATCH_ENABLED: false });
    const agent = JSON.stringify({ token: "pending", leaseUntil: Date.now() + 60_000 });
    await api.db.insert(doubanMapping).values({ doubanId: 103, agent });
    let acked = 0;
    const unexpectedRetry = () => assert.fail("disabled jobs must not retry or invoke AI");
    const batch: MessageBatch<AgentMatchJob> = {
      queue: "agent-match-test",
      messages: [
        {
          id: "pending-message",
          timestamp: new Date(),
          attempts: 1,
          body: { doubanId: 103, agentToken: "pending" },
          ack() {
            acked += 1;
          },
          retry: unexpectedRetry,
        },
      ],
      ackAll: () => assert.fail("expected per-message acknowledgment"),
      retryAll: unexpectedRetry,
    };
    await handleAgentMatchBatch(batch, env, ctx);
    assert.equal(acked, 1);
    const row = await api.db.query.doubanMapping.findFirst({ where: eq(doubanMapping.doubanId, 103) });
    assert.equal(row?.agent, agent);
  });
});

test("disabled cron preserves deterministic matching without recovering or claiming AI jobs", async () => {
  await withTestContext(async (env, ctx) => {
    Object.assign(env, { AGENT_MATCH_ENABLED: false });
    const sent: AgentMatchJob[] = [];
    Object.assign(env, { AGENT_MATCH_QUEUE: { send: async (job: AgentMatchJob) => sent.push(job) } });
    const agent = JSON.stringify({ token: "expired", leaseUntil: Date.now() - 1 });
    await api.db.insert(doubanMapping).values([
      { doubanId: 104, imdbId: "tt-matched" },
      { doubanId: 105, agent },
    ]);
    try {
      mock.method(api.traktAPI, "searchByImdbId", async () => [
        { type: "movie", movie: { ids: { trakt: 104, tmdb: 104, imdb: "tt-matched" } } },
      ]);
      mock.method(api.doubanAPI, "getSubjectDetail", async () => null);
      await scheduled({ scheduledTime: 0, cron: "0 * * * *", noRetry() {} }, env, ctx);
      assert.deepEqual(sent, []);
      const matched = await api.db.query.doubanMapping.findFirst({ where: eq(doubanMapping.doubanId, 104) });
      const leftover = await api.db.query.doubanMapping.findFirst({ where: eq(doubanMapping.doubanId, 105) });
      assert.equal(matched?.tmdbId, 104);
      assert.equal(leftover?.agent, agent);
    } finally {
      mock.restoreAll();
    }
  });
});

test("usage reporting stays local by default even when a reporting token is present", async () => {
  await withTestContext(async (env) => {
    Reflect.deleteProperty(env, "TOKENS_REPORT_ENABLED");
    Object.assign(env, { TOKENS_API_TOKEN: "test-only-token" });
    assert.equal(isTokensReportEnabled(env), false);
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return Response.json({});
    };
    await reportPiUsage(
      [{ model: "test-model", input: 7, output: 2, cacheRead: 0, cacheWrite: 0, messages: 1, costMicro: 0 }],
      { now: new Date("2026-10-27T01:00:00Z"), fetch: fetchImpl },
    );
    assert.equal(requests, 0);
    const stored = await env.STREMIO_ADDON_DOUBAN.prepare("SELECT input, output FROM pi_token_usage").first();
    assert.deepEqual(stored, { input: 7, output: 2 });
  });
});
