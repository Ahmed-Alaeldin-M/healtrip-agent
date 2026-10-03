/**
 * Maps user/LLM supplied filter values (Arabic or English, any spelling) to the English values stored in the DB.
 * Deterministic and offline: alias table + Arabic text normalisation + whole-phrase containment + small typo tolerance.
 */

export interface Facets {
  cities: string[];
  countries: string[];
  specialties: string[];
  types: string[];
}

interface Entity {
  /** English spellings; the one that exists in the DB wins, otherwise the first */
  en: string[];
  ar: string[];
}

const AR_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const STOP_WORDS = new Set(["في", "مدينه", "منطقه", "محافظه", "دوله", "city", "in", "of", "the"]);

export function normalizeText(input: string): string {
  const s = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(AR_MARKS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return s
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

const CITIES: Entity[] = [
  { en: ["Riyadh", "Riyad", "Ar Riyadh"], ar: ["الرياض", "رياض"] },
  { en: ["Jeddah", "Jiddah", "Jedda", "Jidda"], ar: ["جدة", "جده"] },
  { en: ["Dubai"], ar: ["دبي", "دبى"] },
  { en: ["Abu Dhabi"], ar: ["أبوظبي", "أبو ظبي", "ابوظبي"] },
  { en: ["Sharjah"], ar: ["الشارقة"] },
  { en: ["Ajman"], ar: ["عجمان"] },
  { en: ["Al Ain"], ar: ["العين"] },
  { en: ["Ras Al Khaimah", "RAK"], ar: ["رأس الخيمة", "راس الخيمة"] },
  { en: ["Fujairah"], ar: ["الفجيرة"] },
  { en: ["Makkah", "Mecca", "Mekka"], ar: ["مكة", "مكة المكرمة", "مكه"] },
  { en: ["Madinah", "Medina", "Al Madinah"], ar: ["المدينة", "المدينة المنورة", "المدينه المنوره"] },
  { en: ["Dammam", "Ad Dammam"], ar: ["الدمام"] },
  { en: ["Khobar", "Al Khobar"], ar: ["الخبر"] },
  { en: ["Dhahran"], ar: ["الظهران"] },
  { en: ["Taif", "At Taif"], ar: ["الطائف"] },
  { en: ["Abha"], ar: ["أبها", "ابها"] },
  { en: ["Tabuk"], ar: ["تبوك"] },
  { en: ["Buraidah", "Buraydah"], ar: ["بريدة"] },
  { en: ["Hail", "Ha'il"], ar: ["حائل"] },
  { en: ["Jazan", "Jizan"], ar: ["جازان", "جيزان"] },
  { en: ["Doha"], ar: ["الدوحة"] },
  { en: ["Kuwait City"], ar: ["الكويت", "مدينة الكويت"] },
  { en: ["Manama"], ar: ["المنامة"] },
  { en: ["Muscat"], ar: ["مسقط"] },
  { en: ["Cairo"], ar: ["القاهرة"] },
  { en: ["Alexandria"], ar: ["الإسكندرية", "اسكندرية"] },
  { en: ["Amman"], ar: ["عمّان", "عمان"] },
  { en: ["Beirut"], ar: ["بيروت"] },
  { en: ["Istanbul"], ar: ["إسطنبول", "اسطنبول"] },
  { en: ["London"], ar: ["لندن"] },
];

const COUNTRIES: Entity[] = [
  { en: ["Saudi Arabia", "KSA", "Kingdom of Saudi Arabia", "Saudi"], ar: ["السعودية", "المملكة العربية السعودية", "المملكة", "سعودي"] },
  { en: ["UAE", "United Arab Emirates", "Emirates"], ar: ["الإمارات", "الإمارات العربية المتحدة", "الامارات", "الإمارات العربيه المتحده"] },
  { en: ["Qatar"], ar: ["قطر"] },
  { en: ["Kuwait"], ar: ["الكويت"] },
  { en: ["Bahrain"], ar: ["البحرين"] },
  { en: ["Oman"], ar: ["عمان", "سلطنة عمان"] },
  { en: ["Egypt"], ar: ["مصر"] },
  { en: ["Jordan"], ar: ["الأردن"] },
  { en: ["Lebanon"], ar: ["لبنان"] },
  { en: ["Turkey", "Türkiye"], ar: ["تركيا"] },
  { en: ["United Kingdom", "UK", "Britain"], ar: ["بريطانيا", "المملكة المتحدة"] },
];

const SPECIALTIES: Entity[] = [
  { en: ["Cardiology", "Cardiologist", "Heart"], ar: ["قلب", "القلب", "أمراض القلب", "طب القلب", "قلبية", "القلب والأوعية الدموية", "طبيب قلب", "أخصائي قلب"] },
  { en: ["Pediatrics", "Paediatrics", "Pediatrician"], ar: ["أطفال", "الأطفال", "طب الأطفال", "طبيب أطفال"] },
  { en: ["Orthopedics", "Orthopaedics", "Orthopedic"], ar: ["عظام", "العظام", "جراحة العظام", "طب العظام"] },
  { en: ["Neurology", "Neurologist"], ar: ["أعصاب", "الأعصاب", "مخ وأعصاب", "طب الأعصاب", "المخ والأعصاب"] },
  { en: ["Internal Medicine", "Internist"], ar: ["باطنية", "الباطنية", "باطنة", "الباطنة", "طب باطني", "الأمراض الباطنية", "الطب الباطني"] },
  { en: ["Gastroenterology", "Gastro"], ar: ["جهاز هضمي", "الجهاز الهضمي", "أمراض الجهاز الهضمي", "معدة", "المعدة والجهاز الهضمي", "هضمي"] },
  { en: ["Dermatology", "Dermatologist"], ar: ["جلدية", "الجلدية", "أمراض جلدية", "جلد", "الجلد", "جلدية وتجميل"] },
  { en: ["Urology", "Urologist"], ar: ["مسالك بولية", "المسالك البولية", "مسالك"] },
  { en: ["Ophthalmology", "Eye"], ar: ["عيون", "العيون", "طب العيون", "رمد"] },
  { en: ["Oncology", "Oncologist"], ar: ["أورام", "الأورام", "طب الأورام", "سرطان"] },
  { en: ["Gynecology", "Gynaecology", "Obstetrics and Gynecology", "OB/GYN", "OBGYN"], ar: ["نساء وولادة", "النساء والولادة", "أمراض النساء", "نسائية", "نساء", "نساء وتوليد"] },
  { en: ["ENT", "Ear Nose and Throat", "Otolaryngology"], ar: ["أنف وأذن وحنجرة", "الأنف والأذن والحنجرة", "أنف وأذن", "أذن وأنف وحنجرة"] },
  { en: ["Psychiatry"], ar: ["نفسية", "الطب النفسي", "طب نفسي", "أمراض نفسية"] },
  { en: ["Endocrinology"], ar: ["غدد صماء", "الغدد الصماء", "سكري"] },
  { en: ["Nephrology"], ar: ["كلى", "الكلى", "أمراض الكلى"] },
  { en: ["Pulmonology"], ar: ["صدرية", "الصدرية", "أمراض الصدر", "رئة"] },
  { en: ["Rheumatology"], ar: ["روماتيزم", "الروماتيزم", "روماتويد"] },
  { en: ["Dentistry", "Dental"], ar: ["أسنان", "الأسنان", "طب الأسنان"] },
  { en: ["General Surgery", "Surgery"], ar: ["جراحة عامة", "الجراحة العامة", "جراحة"] },
  { en: ["Family Medicine"], ar: ["طب الأسرة", "طب أسرة"] },
  { en: ["Radiology"], ar: ["أشعة", "الأشعة"] },
  { en: ["Hematology"], ar: ["أمراض الدم", "دم"] },
];

const TYPES: Entity[] = [
  { en: ["doctor", "doctors", "physician"], ar: ["طبيب", "أطباء", "دكتور", "دكتورة", "طبيبة"] },
  { en: ["hospital", "hospitals", "clinic"], ar: ["مستشفى", "مستشفيات", "مشفى", "عيادة"] },
];

export type Field = "city" | "country" | "specialty" | "type";
const TABLES: Record<Field, Entity[]> = { city: CITIES, country: COUNTRIES, specialty: SPECIALTIES, type: TYPES };

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

interface Index {
  entities: Entity[];
  alias: Map<string, number>; // normalised alias -> entity index
}

const indexCache = new Map<string, Index>();

function buildIndex(field: Field, dbValues: string[]): Index {
  const key = `${field}|${dbValues.join("\u0000")}`;
  const hit = indexCache.get(key);
  if (hit) return hit;
  const entities: Entity[] = TABLES[field].map((e) => ({ en: [...e.en], ar: [...e.ar] }));
  const alias = new Map<string, number>();
  const add = (text: string, idx: number) => {
    const n = normalizeText(text);
    if (n && !alias.has(n)) alias.set(n, idx);
  };
  entities.forEach((e, i) => [...e.en, ...e.ar].forEach((t) => add(t, i)));
  // DB values the table has never heard of still resolve (case/spacing/typos) to themselves.
  for (const v of dbValues) {
    const n = normalizeText(v);
    if (!n) continue;
    const found = alias.get(n);
    if (found === undefined) {
      entities.push({ en: [v], ar: [] });
      alias.set(n, entities.length - 1);
    }
  }
  const index = { entities, alias };
  if (indexCache.size > 50) indexCache.clear();
  indexCache.set(key, index);
  return index;
}

export type MatchKind = "exact" | "contains" | "fuzzy" | "none";

export interface Resolution {
  /** value to put in the SQL filter */
  value: string;
  kind: MatchKind;
  /** true if the resolved value exists in the DB */
  inDb: boolean;
}

export function resolveValue(field: Field, raw: string, dbValues: string[]): Resolution {
  const input = normalizeText(raw);
  const trimmed = raw.trim();
  if (!input) return { value: trimmed, kind: "none", inDb: false };
  const { entities, alias } = buildIndex(field, dbValues);
  const dbByNorm = new Map(dbValues.map((v) => [normalizeText(v), v]));

  let entityIdx: number | undefined = alias.get(input);
  let kind: MatchKind = entityIdx !== undefined ? "exact" : "none";

  if (entityIdx === undefined) {
    // whole-phrase containment, longest alias wins ("طبيب قلب" -> قلب, "Riyadh City" -> riyadh)
    const padded = ` ${input} `;
    let best: { len: number; idx: number } | null = null;
    let tie = false;
    for (const [a, idx] of alias) {
      if (a.length < 2 || !padded.includes(` ${a} `)) continue;
      if (!best || a.length > best.len) { best = { len: a.length, idx }; tie = false; }
      else if (a.length === best.len && idx !== best.idx) tie = true;
    }
    if (best && !tie) { entityIdx = best.idx; kind = "contains"; }
  }

  if (entityIdx === undefined && input.length >= 5) {
    const max = input.length >= 9 ? 2 : 1;
    let best = max + 1;
    let idx: number | undefined;
    let tie = false;
    for (const [a, i] of alias) {
      if (a.length < 5) continue;
      const d = levenshtein(input, a, max);
      if (d < best) { best = d; idx = i; tie = false; }
      else if (d === best && i !== idx) tie = true;
    }
    if (idx !== undefined && !tie && best <= max) { entityIdx = idx; kind = "fuzzy"; }
  }

  if (entityIdx === undefined) {
    const dbHit = dbByNorm.get(input);
    return dbHit ? { value: dbHit, kind: "exact", inDb: true } : { value: trimmed, kind: "none", inDb: false };
  }

  const entity = entities[entityIdx]!;
  for (const variant of [...entity.en, ...entity.ar]) {
    const db = dbByNorm.get(normalizeText(variant));
    if (db) return { value: db, kind, inDb: true };
  }
  return { value: entity.en[0]!, kind, inDb: false };
}

export interface RawFilters {
  specialty?: string | null;
  city?: string | null;
  country?: string | null;
  provider_type?: string | null;
}

export interface CanonicalFilters {
  filters: { specialty?: string; city?: string; country?: string; provider_type?: string };
  /** original -> canonical, only where they differ */
  resolved: Record<string, { from: string; to: string }>;
  /** fields whose value is not (or not known to be) in the database */
  unrecognized: string[];
}

export function canonicalizeFilters(raw: RawFilters, facets: Facets): CanonicalFilters {
  const out: CanonicalFilters = { filters: {}, resolved: {}, unrecognized: [] };
  const pairs: [keyof RawFilters, Field, string[], keyof CanonicalFilters["filters"]][] = [
    ["specialty", "specialty", facets.specialties, "specialty"],
    ["city", "city", facets.cities, "city"],
    ["country", "country", facets.countries, "country"],
    ["provider_type", "type", facets.types, "provider_type"],
  ];
  for (const [key, field, values, target] of pairs) {
    const text = raw[key]?.trim();
    if (!text) continue;
    const r = resolveValue(field, text, values);
    out.filters[target] = r.value;
    if (r.value !== text) out.resolved[key] = { from: text, to: r.value };
    if (!r.inDb) out.unrecognized.push(key);
  }
  return out;
}
