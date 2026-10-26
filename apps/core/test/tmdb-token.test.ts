import assert from "node:assert/strict";
import test from "node:test";
import { TmdbAPI } from "../src/libs/api/tmdb";
import { asyncLocalStorage } from "../src/libs/middleware/context";

const JWT = "eyJhbGciOiJIUzI1NiJ9.e30.sig";
const V3 = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d";

async function authentication(apiKey?: string, envKey = JWT) {
  return asyncLocalStorage.run(
    { env: { TMDB_API_KEY: envKey } as CloudflareBindings, ctx: {} as ExecutionContext },
    async () => {
      const api = new TmdbAPI(apiKey);
      let request: { auth?: string; params: Record<string, unknown> } | undefined;
      api.axios.defaults.adapter = async (config) => {
        request = {
          auth: config.headers.get("Authorization")?.toString(),
          params: config.params,
        };
        return { data: { results: [] }, status: 200, statusText: "OK", headers: {}, config };
      };
      await api.search("movie", { query: "测试", year: "2024" });
      assert.ok(request);
      return request;
    },
  );
}

test("TmdbAPI sends a Worker v3 API key as api_key and preserves search parameters", async () => {
  assert.deepEqual(await authentication(undefined, ` ${V3} `), {
    auth: undefined,
    params: { query: "测试", year: "2024", api_key: V3 },
  });
});

test("TmdbAPI sends a Worker Read Access Token as Bearer without api_key", async () => {
  assert.deepEqual(await authentication(undefined, ` ${JWT} `), {
    auth: `Bearer ${JWT}`,
    params: { query: "测试", year: "2024" },
  });
});

test("a valid user v3 key overrides the Worker token", async () => {
  assert.deepEqual(await authentication(` ${V3} `), {
    auth: undefined,
    params: { query: "测试", year: "2024", api_key: V3 },
  });
});

test("a valid user Read Access Token overrides the Worker v3 key", async () => {
  const userJwt = "eyJhbGciOiJIUzI1NiJ9.e30.user";
  assert.deepEqual(await authentication(userJwt, V3), {
    auth: `Bearer ${userJwt}`,
    params: { query: "测试", year: "2024" },
  });
});

test("empty or invalid user credentials retain the Worker fallback", async () => {
  for (const userKey of ["", "   ", "not-a-tmdb-key"]) {
    const request = await authentication(userKey, V3);
    assert.equal(request.auth, undefined);
    assert.equal(request.params.api_key, V3);
  }
});
