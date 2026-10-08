/**
 * Adapter Kalender Makro Terjadwal (spec §3.10).
 *
 * Mengumpulkan event makro terjadwal mendatang:
 *  - Pertemuan FOMC Federal Reserve (jadwal resmi 2026-2027)
 *  - Tanggal rilis CPI & NFP AS via FRED API
 *
 * Rentang horizon default: 14 hari ke depan dari `now`.
 *
 * Invarian:
 *  - FOMC menggunakan jadwal statis terverifikasi (data/fomc-meetings.json).
 *  - FRED API release dates opsional: jika FRED_API_KEY tidak ada, FOMC tetap berjalan.
 *  - Output dinormalisasi ke ContextMacroEvent dengan format ISO Date (UTC).
 *  - Waktu rilis New York (EDT/EST) dikonversi ke UTC dengan memperhitungkan DST.
 *  - Tidak pernah melempar error (graceful degradation).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextMacroEvent } from "../agents/context.ts";

export interface FomcMeetingRaw {
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  endDate: string; // YYYY-MM-DD
  hasSep: boolean; // Summary of Economic Projections
}

export interface FomcDataFile {
  source: string;
  verifiedAt: string;
  meetings: FomcMeetingRaw[];
}

export interface MacroCalendarOptions {
  apiKey?: string;
  timeoutMs?: number;
  lookaheadDays?: number;
  now?: Date;
  fetchFn?: typeof fetch;
}

export interface FredReleaseDatesResponse {
  release_dates?: Array<{
    release_id: number;
    date: string; // YYYY-MM-DD
  }>;
}

/**
 * Konversi tanggal (YYYY-MM-DD) dan waktu New York (HH:mm) menjadi Date UTC.
 * Memperhitungkan Daylight Saving Time (EDT = UTC-4, EST = UTC-5).
 */
export function parseNewYorkDateTime(dateStr: string, timeStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const [hourStr, minStr] = timeStr.split(":");
  const year = parseInt(yearStr ?? "1970", 10);
  const month = parseInt(monthStr ?? "1", 10);
  const day = parseInt(dayStr ?? "1", 10);
  const hour = parseInt(hourStr ?? "0", 10);
  const minute = parseInt(minStr ?? "0", 10);

  // Gunakan tengah hari tanggal tersebut untuk menentukan offset zona waktu America/New_York
  const middayUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  let offsetMinutes = -300; // default EST (-5 jam)
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(middayUtc);
    const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
    if (tzPart) {
      const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === "-" ? -1 : 1;
        const h = parseInt(match[2] ?? "0", 10);
        const m = match[3] ? parseInt(match[3], 10) : 0;
        offsetMinutes = sign * (h * 60 + m);
      }
    }
  } catch {
    // Fallback jika formatToParts tidak didukung
    offsetMinutes = -300;
  }

  // Waktu New York = UTC + offsetMinutes => UTC = New York - offsetMinutes
  const localTargetTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(localTargetTimestamp - offsetMinutes * 60 * 1000);
}

/**
 * Muat daftar rapat FOMC dari file data/fomc-meetings.json.
 */
export function loadFomcMeetings(): FomcMeetingRaw[] {
  try {
    const filePath = join(
      new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "data",
      "fomc-meetings.json",
    );
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as FomcDataFile;
    return Array.isArray(parsed.meetings) ? parsed.meetings : [];
  } catch {
    return [];
  }
}

/**
 * Dapatkan event FOMC yang terjadwal dalam rentang ke depan (default 14 hari).
 * Keputusan suku bunga dirilis pukul 14:00 New York Time pada hari kedua rapat.
 */
export function getScheduledFomcEvents(
  now: Date = new Date(),
  lookaheadDays: number = 14,
): ContextMacroEvent[] {
  const meetings = loadFomcMeetings();
  const maxTime = now.getTime() + lookaheadDays * 24 * 3600 * 1000;
  const events: ContextMacroEvent[] = [];

  for (const m of meetings) {
    // Keputusan dirilis pukul 14:00 New York Time pada endDate
    const scheduledAt = parseNewYorkDateTime(m.endDate, "14:00");
    const schedMs = scheduledAt.getTime();

    if (schedMs >= now.getTime() && schedMs <= maxTime) {
      const name = m.hasSep
        ? "FOMC Rate Decision (with SEP)"
        : "FOMC Rate Decision";
      events.push({
        id: `macro-fomc-${m.endDate}`,
        name,
        scheduledAt,
        importance: "HIGH",
      });
    }
  }

  return events;
}

/**
 * Ambil tanggal rilis BLS/FRED (mis. CPI atau NFP) dalam rentang ke depan.
 * Keputusan biasanya dirilis pukul 08:30 New York Time.
 */
export async function fetchFredReleaseDates(opts: {
  releaseId: number;
  releaseName: string;
  eventPrefix: string;
  apiKey?: string;
  timeoutMs?: number;
  lookaheadDays?: number;
  now?: Date;
  fetchFn?: typeof fetch;
}): Promise<{ events: ContextMacroEvent[]; warning?: string }> {
  const {
    releaseId,
    releaseName,
    eventPrefix,
    apiKey = process.env.FRED_API_KEY,
    timeoutMs = 10_000,
    lookaheadDays = 14,
    now = new Date(),
    fetchFn = fetch,
  } = opts;

  if (!apiKey) {
    return {
      events: [],
      warning: `FRED: FRED_API_KEY tidak dikonfigurasi untuk kalender ${eventPrefix.toUpperCase()}`,
    };
  }

  const startDateStr = now.toISOString().slice(0, 10);
  const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${releaseId}&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true&sort_order=asc&realtime_start=${startDateStr}`;

  const maxTime = now.getTime() + lookaheadDays * 24 * 3600 * 1000;
  const events: ContextMacroEvent[] = [];

  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return {
        events: [],
        warning: `FRED release ${releaseId} (${eventPrefix}): HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as FredReleaseDatesResponse;
    const releaseDates = data.release_dates ?? [];

    for (const item of releaseDates) {
      if (!item.date) continue;
      // BLS merilis data pukul 08:30 New York Time
      const scheduledAt = parseNewYorkDateTime(item.date, "08:30");
      const schedMs = scheduledAt.getTime();

      if (schedMs >= now.getTime() && schedMs <= maxTime) {
        events.push({
          id: `macro-${eventPrefix.toLowerCase()}-${item.date}`,
          name: releaseName,
          scheduledAt,
          importance: "HIGH",
        });
      }
    }

    return { events };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      events: [],
      warning: `FRED release ${releaseId} (${eventPrefix}): ${msg}`,
    };
  }
}

/**
 * Kumpulkan seluruh event kalender makro (FOMC, CPI, NFP) dalam rentang lookahead.
 */
export async function fetchMacroCalendarEvents(
  opts: MacroCalendarOptions = {},
): Promise<{ events: ContextMacroEvent[]; warnings: string[] }> {
  const {
    apiKey = process.env.FRED_API_KEY,
    timeoutMs = 10_000,
    lookaheadDays = 14,
    now = new Date(),
    fetchFn = fetch,
  } = opts;

  const warnings: string[] = [];
  const events: ContextMacroEvent[] = [];

  // 1. FOMC dari dataset statis terverifikasi (tidak memerlukan network)
  try {
    const fomcEvents = getScheduledFomcEvents(now, lookaheadDays);
    events.push(...fomcEvents);
  } catch (err) {
    warnings.push(`FOMC calendar error: ${String(err)}`);
  }

  // 2. CPI (Release ID 10) & NFP (Release ID 50) via FRED API
  const fredJobs = [
    fetchFredReleaseDates({
      releaseId: 10,
      releaseName: "US Consumer Price Index (CPI) Release",
      eventPrefix: "cpi",
      apiKey,
      timeoutMs,
      lookaheadDays,
      now,
      fetchFn,
    }),
    fetchFredReleaseDates({
      releaseId: 50,
      releaseName: "US Non-Farm Payrolls (NFP) Release",
      eventPrefix: "nfp",
      apiKey,
      timeoutMs,
      lookaheadDays,
      now,
      fetchFn,
    }),
  ];

  const fredResults = await Promise.allSettled(fredJobs);

  for (const res of fredResults) {
    if (res.status === "fulfilled") {
      events.push(...res.value.events);
      if (res.value.warning) {
        warnings.push(res.value.warning);
      }
    } else {
      warnings.push(`FRED calendar crash: ${String(res.reason)}`);
    }
  }

  // Urutkan event berdasarkan scheduledAt ascending
  events.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  return { events, warnings };
}
