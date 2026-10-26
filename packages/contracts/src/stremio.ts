import type { CollectionConfig } from "./collections";
import type { BridgeDetail, BridgeItem } from "./index";

export type MediaLink = { name: string; category: string; url: string };
export type StremioVideo = {
  id: string;
  title: string;
  season: number;
  episode: number;
  released?: string;
  overview?: string;
  thumbnail?: string;
};
export type StremioManifestData = { redirectConfig: string } | { catalogs: CollectionConfig[] };
export type StremioCatalogItem = BridgeItem & { genres: string[]; links: MediaLink[] };
export type StremioDetailItem = BridgeDetail & {
  links: MediaLink[];
  videos?: StremioVideo[];
  language?: string;
  country?: string;
  awards?: string;
};
