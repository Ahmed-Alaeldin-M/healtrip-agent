import Database from "better-sqlite3";
import { getConfig } from "./config";
import { AppError } from "./errors";

export interface Provider {
  id: string;
  type: "doctor" | "hospital";
  name: string;
  specialty: string | null;
  city: string;
  country: string;
  languages: string;
  description: string;
  accepts_second_opinion: boolean;
  emergency_capable: boolean;
}

export interface ProviderFilters {
  specialty?: string | null;
  city?: string | null;
  country?: string | null;
  provider_type?: string | null;
  second_opinion?: boolean;
  emergency?: boolean;
}

let db: Database.Database | null = null;

function open(): Database.Database {
  if (db && db.open) return db;
  try {
    db = new Database(getConfig().DB_PATH, { readonly: true, fileMustExist: true, timeout: 5000 });
    return db;
  } catch (err) {
    db = null;
    throw new AppError("DB_UNAVAILABLE", { cause: err });
  }
}

type Row = Omit<Provider, "accepts_second_opinion" | "emergency_capable"> & {
  accepts_second_opinion: number;
  emergency_capable: number;
};

function toProvider(r: Row): Provider {
  return { ...r, accepts_second_opinion: r.accepts_second_opinion === 1, emergency_capable: r.emergency_capable === 1 };
}

function run<T>(fn: (d: Database.Database) => T): T {
  const d = open();
  try {
    return fn(d);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const code = (err as { code?: string }).code ?? "";
    // Corrupt/locked/IO errors: drop the handle so the next call reconnects.
    if (/SQLITE_(CORRUPT|NOTADB|IOERR|CANTOPEN|BUSY|LOCKED|READONLY)/.test(code) || !d.open) {
      try { d.close(); } catch { /* already closed */ }
      db = null;
      throw new AppError("DB_UNAVAILABLE", { cause: err });
    }
    throw new AppError("DB_QUERY_FAILED", { cause: err });
  }
}

export function filterProviders(f: ProviderFilters): Provider[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const eq = (col: string, v?: string | null) => {
    const t = v?.trim();
    if (t) { where.push(`LOWER(${col}) = LOWER(?)`); params.push(t); }
  };
  eq("specialty", f.specialty);
  eq("city", f.city);
  eq("country", f.country);
  eq("type", f.provider_type);
  if (f.second_opinion) where.push("accepts_second_opinion = 1");
  if (f.emergency) where.push("emergency_capable = 1");

  const sql = `SELECT * FROM providers${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY id`;
  return run((d) => (d.prepare(sql).all(...params) as Row[]).map(toProvider));
}

export function getAllProviderIds(): string[] {
  return run((d) => (d.prepare("SELECT id FROM providers ORDER BY id").all() as { id: string }[]).map((r) => r.id));
}

export function dbHealthy(): boolean {
  try {
    run((d) => d.prepare("SELECT 1").get());
    return true;
  } catch {
    return false;
  }
}

export interface DbFacets {
  cities: string[];
  countries: string[];
  specialties: string[];
  types: string[];
}

let facetCache: { at: number; value: DbFacets } | null = null;

/** Distinct filterable values, cached briefly. Used to map Arabic/misspelled input onto what the DB really contains. */
export function getFacets(): DbFacets {
  if (facetCache && Date.now() - facetCache.at < 60_000) return facetCache.value;
  const value = run((d) => {
    const col = (c: string) =>
      (d.prepare(`SELECT DISTINCT ${c} AS v FROM providers WHERE ${c} IS NOT NULL AND TRIM(${c}) <> '' ORDER BY ${c}`).all() as { v: string }[]).map((r) => r.v);
    return { cities: col("city"), countries: col("country"), specialties: col("specialty"), types: col("type") };
  });
  facetCache = { at: Date.now(), value };
  return value;
}
