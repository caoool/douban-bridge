import type { MediaLink } from "@douban-bridge/contracts/stremio";

export function httpUrl(value: string | null | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Stremio parses links as absolute URLs; one relative/empty URL rejects the whole meta.
export function validLinks(links: MediaLink[]): MediaLink[] {
  return links.flatMap((link) => {
    const url = httpUrl(link.url);
    return url ? [{ ...link, url }] : [];
  });
}

export function movieVideoId(item: { mediaType: "movie" | "tv"; imdbId: string | null; tmdbId: number | null }) {
  if (item.mediaType !== "movie") return undefined;
  if (item.imdbId && /^tt\d+$/.test(item.imdbId)) return item.imdbId;
  return item.tmdbId ? `tmdb:${item.tmdbId}` : undefined;
}
