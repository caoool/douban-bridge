import { z } from "zod/v4";

const tmdbImageSchema = z.string().transform((v) => (v ? `https://image.tmdb.org/t/p/original${v}` : null));

const tmdbSearchResultItemBaseSchema = z.object({
  id: z.int(),
  backdrop_path: tmdbImageSchema.nullish(),
  poster_path: tmdbImageSchema.nullish(),
});

export const tmdbSearchResultItemSchema = z
  .union([
    z.object({
      ...tmdbSearchResultItemBaseSchema.shape,
      title: z.string(),
      original_title: z.string().nullish(),
      release_date: z.string().nullish(),
      first_air_date: z.string().nullish(),
    }),
    z.object({
      ...tmdbSearchResultItemBaseSchema.shape,
      name: z.string(),
      original_name: z.string().nullish(),
      release_date: z.string().nullish(),
      first_air_date: z.string().nullish(),
    }),
  ])
  .transform((v) => ({
    ...v,
    title: (v as { title?: string }).title ?? (v as { name?: string }).name,
    original_title:
      (v as { original_title?: string }).original_title ?? (v as { original_name?: string }).original_name,
  }));

export const tmdbSearchResultSchema = z.object({
  results: z.array(tmdbSearchResultItemSchema),
  total_results: z.number().nullish(),
});

export const tmdbFindResultSchema = z.object({
  movie_results: z.array(tmdbSearchResultItemSchema).catch([]),
  tv_results: z.array(tmdbSearchResultItemSchema).catch([]),
  tv_episode_results: z.array(tmdbSearchResultItemSchema).catch([]),
});

const tmdbImageDataSchema = z.object({
  file_path: tmdbImageSchema,
  vote_average: z.number(),
  vote_count: z.number(),
  iso_639_1: z.string().nullish(),
  iso_3166_1: z.string().nullish(),
});

export type TmdbImageData = z.output<typeof tmdbImageDataSchema>;

const tmdbImageDataListSchema = z.array(tmdbImageDataSchema).catch([]);

export const tmdbSubjectImagesSchema = z.object({
  backdrops: tmdbImageDataListSchema,
  posters: tmdbImageDataListSchema,
  logos: tmdbImageDataListSchema,
});

export const tmdbSeriesSeasonsSchema = z.object({
  seasons: z
    .array(z.object({ season_number: z.number().int().nonnegative() }).nullable().catch(null))
    .catch([])
    .transform((items) => items.filter((item) => item !== null)),
});

const tmdbEpisodeSchema = z.object({
  season_number: z.number().int().nonnegative(),
  episode_number: z.number().int().nonnegative(),
  name: z.string().nullish(),
  overview: z.string().nullish(),
  air_date: z.string().nullish(),
  still_path: z.string().nullish(),
});
export const tmdbSeasonEpisodesSchema = z.object({
  episodes: z
    .array(tmdbEpisodeSchema.nullable().catch(null))
    .catch([])
    .transform((items) => items.filter((item) => item !== null)),
});
export type TmdbEpisode = z.output<typeof tmdbEpisodeSchema>;
