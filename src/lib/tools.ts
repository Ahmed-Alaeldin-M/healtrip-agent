import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { filterProviders, getFacets } from "./db";
import { canonicalizeFilters } from "./normalize";
import { classifyError, describeError } from "./errors";
import { searchFiltered } from "./vector-store";

const optionalText = z.string().trim().max(100).nullish();

export const findProvidersSchema = z.object({
  query: z.string().trim().min(1).max(500).describe("Short description of the patient's need, used for semantic matching."),
  specialty: optionalText.describe("Specialty in English, e.g. Cardiology, Neurology, Internal Medicine. Arabic is also accepted."),
  city: optionalText.describe("City in English, e.g. Riyadh. Arabic names (الرياض) are also accepted."),
  country: optionalText.describe("Country in English, e.g. Saudi Arabia. Arabic names (السعودية) are also accepted."),
  provider_type: optionalText.describe("doctor or hospital (Arabic accepted)."),
  second_opinion: z.boolean().default(false).describe("Only providers that accept second opinions."),
  emergency: z.boolean().default(false).describe("Only emergency-capable providers."),
});

/**
 * Never throws: any failure is returned as a structured result so the model can tell the
 * user honestly that provider data is unavailable instead of the whole request crashing.
 */
export const findProviders = tool(
  async (input) => {
    const started = Date.now();
    try {
      // The DB is English-only; users (and the model) often pass Arabic. Map everything onto real DB values first.
      const facets = getFacets();
      const canon = canonicalizeFilters(input, facets);
      const candidates = filterProviders({
        ...canon.filters,
        second_opinion: input.second_opinion,
        emergency: input.emergency,
      });

      if (candidates.length === 0) {
        return JSON.stringify({
          ok: true,
          providers: [],
          note: "No provider in the database matches these filters.",
          filters_used: canon.filters,
          ...(canon.unrecognized.length ? { not_in_database: canon.unrecognized } : {}),
          available: { cities: facets.cities, countries: facets.countries, specialties: facets.specialties },
        });
      }

      const result = await searchFiltered(input.query, candidates, 5);
      console.info(`[find_providers] ${candidates.length} candidates, ranked=${!result.degraded}, ${Date.now() - started}ms`);
      return JSON.stringify({
        ok: true,
        providers: result.providers,
        filters_used: canon.filters,
        ranked: !result.degraded,
        warnings: result.warnings,
      });
    } catch (err) {
      const e = classifyError(err);
      console.error("[find_providers] failed", describeError(err));
      return JSON.stringify({
        ok: false,
        providers: [],
        error: { code: e.code, retryable: e.retryable, message: e.message },
      });
    }
  },
  {
    name: "find_providers",
    description:
      "Search the verified HealTrip provider database. Applies exact SQL filters first, then semantic ranking over the filtered providers. " +
      "Returns JSON: {ok, providers[], ranked?, warnings?, error?}.",
    schema: findProvidersSchema,
  },
);
