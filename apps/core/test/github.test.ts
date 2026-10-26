import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { GitHubAPI } from "../src/libs/api/github";

const TOKEN = "test-oauth-access-token";
const STAR_PATH = "/user/starred/caoool/douban-bridge";

function mockGitHub(t: TestContext, response: (path: string) => Response) {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), `token ${TOKEN}`);
    paths.push(url.pathname);
    return response(url.pathname);
  });
  return paths;
}

const github = () => new GitHubAPI("test-client-id", "test-client-secret");

test("OAuth-verified fork owner is entitled without starring their own repository", async (t) => {
  const paths = mockGitHub(t, (path) => {
    assert.equal(path, "/user");
    return Response.json({ login: "Caoool" });
  });

  assert.equal(await github().checkStarStatus(TOKEN), true);
  assert.deepEqual(paths, ["/user"]);
});

for (const [status, expected] of [
  [204, true],
  [404, false],
  [401, false],
] as const) {
  test(`other users retain the fork star rule (${status})`, async (t) => {
    const paths = mockGitHub(t, (path) => {
      if (path === "/user") return Response.json({ login: "other-user" });
      assert.equal(path, STAR_PATH);
      return new Response(null, { status });
    });

    assert.equal(await github().checkStarStatus(TOKEN), expected);
    assert.deepEqual(paths, ["/user", STAR_PATH]);
  });
}

test("an invalid OAuth token cannot gain owner access", async (t) => {
  const paths = mockGitHub(t, (path) => {
    assert.equal(path, "/user");
    return Response.json({ message: "Bad credentials" }, { status: 401 });
  });

  assert.equal(await github().checkStarStatus(TOKEN), false);
  assert.deepEqual(paths, ["/user"]);
});

for (const failingPath of ["/user", STAR_PATH]) {
  test(`GitHub availability failures still propagate from ${failingPath}`, async (t) => {
    const paths = mockGitHub(t, (path) => {
      if (path === failingPath) return Response.json({ message: "Unavailable" }, { status: 503 });
      assert.equal(path, "/user");
      return Response.json({ login: "other-user" });
    });

    await assert.rejects(github().checkStarStatus(TOKEN), { status: 503 });
    assert.deepEqual(paths, failingPath === "/user" ? ["/user"] : ["/user", STAR_PATH]);
  });
}
