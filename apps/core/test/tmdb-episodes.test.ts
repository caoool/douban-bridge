import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { TmdbAPI } from "../src/libs/api/tmdb";

test("TMDB episodes preserve working seasons when one season or episode is malformed", async () => {
  const api = new TmdbAPI();
  const requested: string[] = [];
  mock.method(api, "request", async ({ url }: { url: string }) => {
    requested.push(url);
    if (url === "/tv/201") {
      return {
        seasons: [
          { season_number: 2 },
          { season_number: 1 },
          { season_number: 0 },
          { season_number: 1 },
          { season_number: -1 },
          null,
        ],
      };
    }
    if (url.endsWith("/2")) throw new Error("upstream unavailable");
    return {
      episodes: [
        { season_number: Number(url.at(-1)), episode_number: 1, name: "第一集", air_date: "2024-01-01" },
        { season_number: 1, episode_number: "broken" },
      ],
    };
  });
  try {
    const episodes = await api.getSeriesEpisodes(201);
    assert.deepEqual(requested, ["/tv/201", "/tv/201/season/0", "/tv/201/season/1", "/tv/201/season/2"]);
    assert.deepEqual(
      episodes.map((episode) => [episode.season_number, episode.episode_number]),
      [
        [0, 1],
        [1, 1],
      ],
    );
  } finally {
    mock.restoreAll();
  }
});
