import type { MediaLink, StremioDetailItem, StremioVideo } from "@douban-bridge/contracts/stremio";
import axios from "axios";
import { HTTPException } from "hono/http-exception";
import { z } from "zod/v4";
import { persistAndEnqueueUnmatched } from "@/libs/agent-match/pool";
import { api } from "@/libs/api";
import { TmdbAPI } from "@/libs/api/tmdb";
import { ImageUrlGenerator } from "@/libs/images";
import { getContext } from "@/libs/middleware";
import type { ImageContext } from "./catalog";

const tmdb = new TmdbAPI();
const cinemetaVideoSchema = z.object({
  season: z.number().int().nonnegative(),
  episode: z.number().int().nonnegative(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  released: z.string().nullish(),
  overview: z.string().nullish(),
});
const cinemetaResponseSchema = z.object({
  meta: z.object({
    videos: z.array(cinemetaVideoSchema.nullable().catch(null)).catch([]),
  }),
});

function absoluteHttpUrl(value: string | null | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function releasedDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function getSeriesVideos(item: StremioDetailItem): Promise<StremioVideo[]> {
  if (item.imdbId) {
    try {
      const response = await fetch(`https://v3-cinemeta.strem.io/meta/series/${item.imdbId}.json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const data = cinemetaResponseSchema.parse(await response.json());
        const videos = data.meta.videos.flatMap((video): StremioVideo[] =>
          video
            ? [
                {
                  id: `${item.imdbId}:${video.season}:${video.episode}`,
                  title: video.title || video.name || `第 ${video.episode} 集`,
                  season: video.season,
                  episode: video.episode,
                  released: releasedDate(video.released),
                  overview: video.overview ?? undefined,
                  // Only use episode identity/text; retain our own artwork providers.
                },
              ]
            : [],
        );
        if (videos.length > 0) return videos;
      }
    } catch {
      // TMDB can supply episodes when Cinemeta has no entry or is unavailable.
    }
  }
  if (!item.tmdbId && item.imdbId) {
    const found = await tmdb.findById(item.imdbId, "imdb_id").catch(() => null);
    if (found?.tv_results.length === 1) item.tmdbId = found.tv_results[0].id;
  }
  if (!item.tmdbId) return [];
  const episodes = await tmdb.getSeriesEpisodes(item.tmdbId).catch(() => []);
  const id = item.imdbId || `tmdb:${item.tmdbId}`;
  return episodes.map((episode) => ({
    id: `${id}:${episode.season_number}:${episode.episode_number}`,
    title: episode.name || `第 ${episode.episode_number} 集`,
    season: episode.season_number,
    episode: episode.episode_number,
    released: releasedDate(episode.air_date),
    overview: episode.overview ?? undefined,
    thumbnail: episode.still_path?.startsWith("/") ? `https://image.tmdb.org/t/p/w500${episode.still_path}` : undefined,
  }));
}

function mapSourceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  if (axios.isAxiosError(error) && error.response?.status === 404) {
    throw new HTTPException(404);
  }
  throw new HTTPException(502);
}

async function loadMeta(doubanId: number, images: ImageContext): Promise<StremioDetailItem> {
  let data: Awaited<ReturnType<typeof api.doubanAPI.getSubjectDetail>>;
  try {
    data = await api.doubanAPI.getSubjectDetail(doubanId);
  } catch (error) {
    mapSourceError(error);
  }
  if (!data) {
    throw new HTTPException(404);
  }

  const { mappingCache, missingIds } = await api.fetchIdMapping([doubanId]);
  const newMappings = await Promise.all(
    missingIds.map(async (id) => {
      try {
        return await api.findExternalId({ doubanId: id, type: data.type, title: data.title });
      } catch {
        return { doubanId: id, tmdbId: null, imdbId: null, traktId: null };
      }
    }),
  );
  for (const mapping of newMappings) mappingCache.set(mapping.doubanId, mapping);
  if (newMappings.length > 0) {
    getContext().ctx.waitUntil(persistAndEnqueueUnmatched(newMappings));
  }
  const mapping = mappingCache.get(doubanId);
  const tmdbId = mapping?.tmdbId ?? null;
  const imdbId = mapping?.imdbId ?? null;

  const generator = new ImageUrlGenerator(images.providers, {
    origin: images.origin,
    userId: images.configId,
  });
  const picture = await generator.generate({
    doubanInfo: {
      cover: data.cover_url || data.pic?.large || data.pic?.normal || "",
      type: data.type,
    },
    tmdbId,
    imdbId,
  });

  return {
    doubanId: data.id,
    mediaType: data.type,
    title: data.title,
    description: data.intro ?? undefined,
    year: data.year ?? undefined,
    rating: data.rating?.value ?? undefined,
    tmdbId,
    imdbId,
    images: {
      poster: picture.poster ?? null,
      background: picture.background ?? null,
      logo: picture.logo ?? null,
    },
    actors: (data.actors ?? []).map((x) => x.name),
    directors: (data.directors ?? []).map((x) => x.name),
    genres: data.genres ?? [],
    links: [
      {
        name: `豆瓣评分：${data.rating?.value ?? "N/A"}`,
        category: "douban",
        url: absoluteHttpUrl(data.url) ?? `https://movie.douban.com/subject/${data.id}/`,
      },
      ...data.linewatches.flatMap((item): MediaLink[] => {
        const url = absoluteHttpUrl(item.source_uri);
        return url ? [{ name: item.source.name, category: "linewatches", url }] : [];
      }),
      ...(data.directors ?? []).map((item) => ({
        name: item.name,
        category: "director",
        url: `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(item.name)}`,
      })),
      ...(data.actors ?? []).map((item) => ({
        name: item.name,
        category: "actor",
        url: `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(item.name)}`,
      })),
    ],
    language: data.languages?.join(" / "),
    country: data.countries?.join(" / "),
    awards: data.honor_infos?.map((item) => item.title).join(" / "),
  };
}

export const getCloudMeta = (id: number, images: ImageContext) => loadMeta(id, images);
export async function getStremioMeta(id: number, images: ImageContext): Promise<StremioDetailItem> {
  // Direct detail links must work before a catalog visit has populated the mapping cache.
  const item = await loadMeta(id, images);
  if (!item.imdbId && item.tmdbId) {
    const external = await tmdb.getExternalId(item.mediaType, item.tmdbId).catch(() => null);
    if (external?.imdb_id && /^tt\d+$/.test(external.imdb_id)) item.imdbId = external.imdb_id;
  }
  if (item.mediaType === "tv") item.videos = await getSeriesVideos(item);
  return item;
}
