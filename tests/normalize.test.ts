import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeFilters, normalizeText, resolveValue, type Facets } from "../src/lib/normalize";
import { getFacets } from "../src/lib/db";
import { findProviders } from "../src/lib/tools";
import { __setEmbedderForTests } from "../src/lib/embeddings";
import { __resetIndexForTests } from "../src/lib/vector-store";
import fs from "node:fs";

const real = getFacets();
const val = (f: Parameters<typeof resolveValue>[0], s: string, db = f === "city" ? real.cities : f === "country" ? real.countries : f === "specialty" ? real.specialties : real.types) =>
  resolveValue(f, s, db).value;

test("normalizeText folds Arabic spelling variants", () => {
  assert.equal(normalizeText("الرِّيَاض"), normalizeText("رياض"));
  assert.equal(normalizeText("أبو ظبي"), normalizeText("ابو ظبي"));
  assert.equal(normalizeText("جدّة"), normalizeText("جده"));
  assert.equal(normalizeText("  Riyadh, "), "riyadh");
});

test("Arabic cities resolve to the English values in the DB", () => {
  assert.equal(val("city", "الرياض"), "Riyadh");
  assert.equal(val("city", "رياض"), "Riyadh");
  assert.equal(val("city", "مدينة الرياض"), "Riyadh");
  assert.equal(val("city", "في الرياض"), "Riyadh");
  assert.equal(val("city", "جدة"), "Jeddah");
  assert.equal(val("city", "جده"), "Jeddah");
  assert.equal(val("city", "دبي"), "Dubai");
  assert.equal(val("city", "riyadh"), "Riyadh");
  assert.equal(val("city", "Riyad"), "Riyadh");
  assert.equal(val("city", "Jedda"), "Jeddah");
});

test("Arabic countries resolve, including variants and phrases", () => {
  assert.equal(val("country", "السعودية"), "Saudi Arabia");
  assert.equal(val("country", "المملكة العربية السعودية"), "Saudi Arabia");
  assert.equal(val("country", "KSA"), "Saudi Arabia");
  assert.equal(val("country", "الإمارات"), "UAE");
  assert.equal(val("country", "الامارات"), "UAE");
  assert.equal(val("country", "الإمارات العربية المتحدة"), "UAE");
  assert.equal(val("country", "United Arab Emirates"), "UAE");
  assert.equal(val("country", "الرياض، السعودية"), "Saudi Arabia");
});

test("Arabic specialties resolve", () => {
  assert.equal(val("specialty", "قلب"), "Cardiology");
  assert.equal(val("specialty", "أمراض القلب"), "Cardiology");
  assert.equal(val("specialty", "طبيب قلب"), "Cardiology");
  assert.equal(val("specialty", "أطفال"), "Pediatrics");
  assert.equal(val("specialty", "عظام"), "Orthopedics");
  assert.equal(val("specialty", "الباطنية"), "Internal Medicine");
  assert.equal(val("specialty", "جلدية"), "Dermatology");
  assert.equal(val("specialty", "مسالك بولية"), "Urology");
  assert.equal(val("specialty", "أنف وأذن وحنجرة"), "ENT");
  assert.equal(val("specialty", "نساء وولادة"), "Gynecology");
  assert.equal(val("specialty", "cardiologist"), "Cardiology");
  assert.equal(val("specialty", "Cardiolgy"), "Cardiology", "typo tolerance");
  assert.equal(val("type", "مستشفى"), "hospital");
  assert.equal(val("type", "دكتور"), "doctor");
});

test("same Arabic word can be a city or a country depending on the field", () => {
  assert.equal(resolveValue("country", "عمان", ["Oman"]).value, "Oman");
  assert.equal(resolveValue("city", "عمان", ["Amman"]).value, "Amman");
  assert.equal(resolveValue("country", "الكويت", ["Kuwait"]).value, "Kuwait");
  assert.equal(resolveValue("city", "الكويت", ["Kuwait City"]).value, "Kuwait City");
});

test("resolves to the DB's own spelling, whatever it is", () => {
  assert.equal(resolveValue("city", "مكة", ["Makkah"]).value, "Makkah");
  assert.equal(resolveValue("city", "مكة المكرمة", ["Mecca"]).value, "Mecca");
  assert.equal(resolveValue("country", "الإمارات", ["United Arab Emirates"]).value, "United Arab Emirates");
  assert.equal(resolveValue("city", "الرياض", ["Ar Riyadh"]).value, "Ar Riyadh");
});

test("DB values the alias table has never seen still match by themselves", () => {
  assert.equal(resolveValue("city", "  tanta ", ["Tanta"]).value, "Tanta");
  assert.equal(resolveValue("specialty", "Podiatry", ["Podiatry"]).inDb, true);
});

test("unknown places are reported, not guessed", () => {
  const r = resolveValue("city", "الدمام", real.cities);
  assert.equal(r.value, "Dammam");
  assert.equal(r.inDb, false);
  const g = resolveValue("city", "غير موجود", real.cities);
  assert.equal(g.kind, "none");
  assert.equal(g.inDb, false);
  const c = canonicalizeFilters({ city: "الدمام", specialty: "قلب" }, real as Facets);
  assert.deepEqual(c.unrecognized, ["city"]);
  assert.deepEqual(c.resolved.specialty, { from: "قلب", to: "Cardiology" });
});

test("no false positives from short or unrelated input", () => {
  assert.equal(resolveValue("city", "x", real.cities).kind, "none");
  assert.equal(resolveValue("city", "   ", real.cities).kind, "none");
  assert.equal(resolveValue("country", "Omaha", real.countries).inDb, false);
});

const vectors = JSON.parse(fs.readFileSync("data/provider_vectors.json", "utf8"));

test("find_providers works end to end with Arabic filters", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => vectors.items[0].vector);
  const out = JSON.parse(await findProviders.invoke({ query: "ألم في الصدر", specialty: "قلب", city: "الرياض", country: "السعودية" }));
  assert.equal(out.ok, true);
  assert.ok(out.providers.length > 0);
  assert.ok(out.providers.every((p: { city: string; specialty: string; country: string }) => p.city === "Riyadh" && p.specialty === "Cardiology" && p.country === "Saudi Arabia"));
  assert.deepEqual(out.filters_used, { specialty: "Cardiology", city: "Riyadh", country: "Saudi Arabia" });

  const hosp = JSON.parse(await findProviders.invoke({ query: "طوارئ", provider_type: "مستشفى", city: "جدة", emergency: true }));
  assert.ok(hosp.providers.every((p: { type: string; city: string }) => p.type === "hospital" && p.city === "Jeddah"));
});

test("no results from an Arabic place that is not in the DB lists what is available", async () => {
  const out = JSON.parse(await findProviders.invoke({ query: "x", city: "الدمام" }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.providers, []);
  assert.deepEqual(out.not_in_database, ["city"]);
  assert.ok(out.available.cities.includes("Riyadh"));
  assert.ok(out.available.specialties.includes("Cardiology"));
});
