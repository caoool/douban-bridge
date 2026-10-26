import assert from "node:assert/strict";
import test, { describe, mock } from "node:test";
import { api } from "../src/libs/api";
import { TmdbAPI } from "../src/libs/api/tmdb";
import { getCloudMeta, getStremioMeta } from "../src/services/metadata";
import { withTestContext } from "./context";

const images = { providers: [], origin: "https://douban-bridge.baran.wang" };

const detail = {
  id: 1,
  type: "movie" as const,
  title: "第一项",
  intro: "简介",
  year: "2023",
  genres: ["剧情"],
  actors: [{ name: "演员" }],
  directors: [{ name: "导演" }],
  rating: { value: 8.5 },
  url: "https://movie.douban.com/subject/1/",
  linewatches: [],
  languages: ["汉语普通话"],
  countries: ["中国"],
  honor_infos: [],
  cover_url: "https://img.example.com/cover.jpg",
};

describe("metadata service", { concurrency: false }, () => {
  test("opening cloud meta matches the missing id once", async () => {
    await withTestContext(async () => {
      try {
        const requested: number[] = [];
        mock.method(api.doubanAPI, "getSubjectDetail", async () => detail);
        mock.method(api, "findExternalId", async ({ doubanId }: { doubanId: number }) => {
          requested.push(doubanId);
          return { doubanId, tmdbId: 201, imdbId: null, traktId: null };
        });
        const result = await getCloudMeta(1, images);
        assert.deepEqual(requested, [1]);
        assert.equal(result.doubanId, 1);
        assert.equal(result.tmdbId, 201);
        assert.equal(result.description, "简介");
        assert.deepEqual(result.actors, ["演员"]);
        assert.deepEqual(result.directors, ["导演"]);
        assert.deepEqual(result.genres, ["剧情"]);
      } finally {
        mock.restoreAll();
      }
    });
  });

  test("opening a direct Stremio detail resolves its playback id before a catalog visit", async () => {
    await withTestContext(async () => {
      try {
        const requested: number[] = [];
        mock.method(api.doubanAPI, "getSubjectDetail", async () => detail);
        mock.method(api, "findExternalId", async ({ doubanId }: { doubanId: number }) => {
          requested.push(doubanId);
          return { doubanId, tmdbId: 201, imdbId: "tt1234567", traktId: null };
        });
        const result = await getStremioMeta(1, images);
        assert.deepEqual(requested, [1]);
        assert.equal(result.doubanId, 1);
        assert.equal(result.tmdbId, 201);
        assert.equal(result.imdbId, "tt1234567");
        assert.equal(result.title, "第一项");
      } finally {
        mock.restoreAll();
      }
    });
  });

  test("metadata only exposes usable absolute links, including when Douban omits the subject URL", async () => {
    await withTestContext(async () => {
      try {
        mock.method(api.doubanAPI, "getSubjectDetail", async () => ({
          ...detail,
          url: "#",
          linewatches: [
            { source: { name: "invalid" }, source_uri: "#" },
            { source: { name: "valid" }, source_uri: "https://example.com/watch" },
          ],
        }));
        mock.method(api, "findExternalId", async () => ({ doubanId: 1, tmdbId: null, imdbId: null, traktId: null }));
        const result = await getCloudMeta(1, images);
        assert.equal(result.links[0].url, "https://movie.douban.com/subject/1/");
        assert.equal(
          result.links.some((link) => link.name === "invalid"),
          false,
        );
        assert.ok(result.links.some((link) => link.category === "actor"));
        for (const link of result.links) assert.equal(new URL(link.url).protocol, "https:");
      } finally {
        mock.restoreAll();
      }
    });
  });

  test("Cinemeta supplies real season/episode ids without replacing artwork with Metahub", async () => {
    await withTestContext(async () => {
      try {
        mock.method(api.doubanAPI, "getSubjectDetail", async () => ({ ...detail, type: "tv" }));
        mock.method(api, "findExternalId", async () => ({
          doubanId: 1,
          tmdbId: 201,
          imdbId: "tt1234567",
          traktId: null,
        }));
        const requests: string[] = [];
        mock.method(globalThis, "fetch", async (input: string) => {
          requests.push(String(input));
          return Response.json({
            meta: {
              videos: [
                {
                  id: "wrong-id",
                  name: "Pilot",
                  season: 1,
                  episode: 1,
                  released: "2023-01-01",
                  thumbnail: "https://images.metahub.space/test",
                },
                { title: "Next season", season: 2, episode: 1, released: "invalid" },
                { title: "Malformed", season: -1, episode: 1 },
              ],
            },
          });
        });
        const result = await getStremioMeta(1, images);
        assert.deepEqual(requests, ["https://v3-cinemeta.strem.io/meta/series/tt1234567.json"]);
        assert.deepEqual(
          result.videos?.map((video) => video.id),
          ["tt1234567:1:1", "tt1234567:2:1"],
        );
        assert.equal(result.videos?.[0].released, "2023-01-01T00:00:00.000Z");
        assert.equal(result.videos?.[0].title, "Pilot");
        assert.equal(result.videos?.[1].released, undefined);
        assert.equal(JSON.stringify(result).includes("metahub"), false);
      } finally {
        mock.restoreAll();
      }
    });
  });

  test("TMDB seasons recover episode selection when Cinemeta is unavailable", async () => {
    await withTestContext(async () => {
      try {
        mock.method(api.doubanAPI, "getSubjectDetail", async () => ({ ...detail, type: "tv" }));
        mock.method(api, "findExternalId", async () => ({ doubanId: 1, tmdbId: 201, imdbId: null, traktId: null }));
        mock.method(TmdbAPI.prototype, "getExternalId", async () => ({ imdb_id: "tt1234567" }));
        mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
        mock.method(TmdbAPI.prototype, "getSeriesEpisodes", async () => [
          { season_number: 0, episode_number: 1, name: "特别篇", air_date: null, still_path: "/still.jpg" },
          { season_number: 2, episode_number: 3, name: "第三集", air_date: "2024-01-02" },
        ]);
        const result = await getStremioMeta(1, images);
        assert.equal(result.imdbId, "tt1234567");
        assert.deepEqual(
          result.videos?.map((video) => video.id),
          ["tt1234567:0:1", "tt1234567:2:3"],
        );
        assert.equal(result.videos?.[0].thumbnail, "https://image.tmdb.org/t/p/w500/still.jpg");
        assert.equal(result.videos?.[1].released, "2024-01-02T00:00:00.000Z");
      } finally {
        mock.restoreAll();
      }
    });
  });

  test("TMDB-only series use namespaced episode ids and provider failures still preserve the detail", async () => {
    await withTestContext(async () => {
      try {
        mock.method(api.doubanAPI, "getSubjectDetail", async () => ({ ...detail, type: "tv" }));
        mock.method(api, "findExternalId", async () => ({ doubanId: 1, tmdbId: 201, imdbId: null, traktId: null }));
        mock.method(TmdbAPI.prototype, "getExternalId", async () => {
          throw new Error("unavailable");
        });
        const episodes = mock.method(TmdbAPI.prototype, "getSeriesEpisodes", async () => [
          { season_number: 1, episode_number: 2, name: "第二集" },
        ]);
        const result = await getStremioMeta(1, images);
        assert.equal(result.videos?.[0].id, "tmdb:201:1:2");
        episodes.mock.mockImplementation(async () => {
          throw new Error("unavailable");
        });
        const failed = await getStremioMeta(1, images);
        assert.equal(failed.title, detail.title);
        assert.deepEqual(failed.videos, []);
      } finally {
        mock.restoreAll();
      }
    });
  });
});
