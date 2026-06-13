import { headers } from "next/headers";
import type {
  PetDossier,
  WalletSummary,
  RaceDetail,
  OddsResponse,
  LeaderboardResponse,
  LeaderboardMetric,
  SiteStats,
  RaceListResponse,
  CalibrationResult,
  ApiError,
} from "./types";

// The site consumes its OWN public API. Server components resolve an absolute
// base from the incoming request; the browser uses a relative path. Either way
// every page's data comes through /api/v1, provable in the network tab.

function serverBase(): string {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function apiBase(): string {
  // In a browser bundle, window exists and relative URLs hit our own origin.
  if (typeof window !== "undefined") return "";
  return serverBase();
}

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface FetchOpts {
  revalidate?: number; // ISR seconds for server fetches
  signal?: AbortSignal;
}

async function apiGet<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = `${apiBase()}/api/v1${path}`;
  const init: RequestInit & { next?: { revalidate: number } } = { signal: opts.signal };
  if (typeof window === "undefined" && opts.revalidate !== undefined) {
    init.next = { revalidate: opts.revalidate };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let code = "error";
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as ApiError;
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // non-JSON error body; keep the default message
    }
    throw new ApiClientError(code, message, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  pet: (id: number | string, o?: FetchOpts) => apiGet<PetDossier>(`/pet/${id}`, o ?? { revalidate: 120 }),
  wallet: (address: string, o?: FetchOpts) => apiGet<WalletSummary>(`/wallet/${address}`, o ?? { revalidate: 60 }),
  race: (id: number | string, mark?: number, o?: FetchOpts) =>
    apiGet<RaceDetail>(`/race/${id}${mark ? `?mark=${mark}` : ""}`, o ?? { revalidate: 60 }),
  odds: (id: number | string, o?: FetchOpts) => apiGet<OddsResponse>(`/odds/race/${id}`, o ?? { revalidate: 120 }),
  leaderboard: (metric: LeaderboardMetric, limit = 25, offset = 0, o?: FetchOpts) =>
    apiGet<LeaderboardResponse>(`/leaderboard?metric=${metric}&limit=${limit}&offset=${offset}`, o ?? { revalidate: 120 }),
  stats: (o?: FetchOpts) => apiGet<SiteStats>(`/stats`, o ?? { revalidate: 60 }),
  races: (track?: number | null, limit = 24, offset = 0, o?: FetchOpts) =>
    apiGet<RaceListResponse>(`/races?limit=${limit}&offset=${offset}${track ? `&track=${track}` : ""}`, o ?? { revalidate: 30 }),
  scan: (petIds: number[], track: number, mark?: number, o?: FetchOpts) =>
    apiGet<RaceDetail>(`/scan?pets=${petIds.join(",")}&track=${track}${mark ? `&mark=${mark}` : ""}`, o ?? { revalidate: 0 }),
  calibration: (o?: FetchOpts) => apiGet<CalibrationResult>(`/calibration`, o ?? { revalidate: 600 }),
};
