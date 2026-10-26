import assert from "node:assert/strict";
import test from "node:test";
import { dashRoute } from "../src/routes/dash";

function request(credentials: Record<string, string>, authorization = "dash:dash") {
  const env = {
    KV: { get: async (key: string) => credentials[key] ?? null },
  } as unknown as CloudflareBindings;
  // The invalid URL returns 400 only after authentication passes, without fetching an image.
  return dashRoute.request(
    "/image-proxy?url=invalid",
    { headers: { Authorization: `Basic ${btoa(authorization)}` } },
    env,
  );
}

test("dashboard denies requests while either admin credential is missing or empty", async () => {
  for (const credentials of [
    {},
    { DASH_USER: "dash" },
    { DASH_PASS: "dash" },
    { DASH_USER: "", DASH_PASS: "dash" },
    { DASH_USER: "dash", DASH_PASS: "" },
  ]) {
    const response = await request(credentials);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate") ?? "", /^Basic /);
  }
});

test("dashboard accepts only the configured username and password", async () => {
  const credentials = { DASH_USER: "dash", DASH_PASS: "dash" };
  assert.equal((await request(credentials)).status, 400);
  assert.equal((await request(credentials, "wrong:dash")).status, 401);
  assert.equal((await request(credentials, "dash:wrong")).status, 401);
});
