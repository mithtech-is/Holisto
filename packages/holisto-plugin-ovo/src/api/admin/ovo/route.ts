import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../modules/online_visibility_optimization"
import { logger } from "../../../utils/logger"

/**
 * GET  /admin/ovo
 * POST /admin/ovo
 *
 * Backs the "OVO" admin page (top-level sidebar entry).
 * Saves are partial — any key omitted is left untouched. After a
 * successful save, fires a best-effort POST to the storefront's
 * /api/revalidate route so the public surfaces (metadata, JSON-LD,
 * /llms.txt, robots, sitemap) reflect the change without waiting on
 * the default 10-minute ISR window.
 *
 * Requires admin auth (bound in `src/api/middlewares.ts`).
 */

const ContactPointSchema = z.object({
  contact_type: z.string(),
  telephone: z.string().nullish(),
  email: z.string().nullish(),
  area_served: z.string().nullish(),
  available_language: z.array(z.string()).optional(),
  hours: z
    .object({
      days: z.array(z.string()),
      opens: z.string(),
      closes: z.string(),
    })
    .nullish(),
})

const FounderSchema = z.object({
  name: z.string(),
  role: z.string().default(""),
  bio: z.string().default(""),
  photo_url: z.string().default(""),
  linkedin_url: z.string().default(""),
})

const PressMentionSchema = z.object({
  publication: z.string(),
  headline: z.string(),
  url: z.string(),
  date: z.string().nullish(),
  logo_url: z.string().nullish(),
})

const BrandSchema = z.object({
  name: z.string(),
  alt_names: z.array(z.string()).default([]),
  legal_name: z.string(),
  slogan: z.string().default(""),
  description: z.string().default(""),
  logo_url: z.string().default(""),
  founding_year: z.string().default(""),
  founding_place: z.string().default(""),
  parent_org: z
    .object({ name: z.string(), url: z.string() })
    .nullish(),
  contact_points: z.array(ContactPointSchema).default([]),
  postal_address: z
    .object({
      street: z.string().default(""),
      city: z.string().default(""),
      region: z.string().default(""),
      postal_code: z.string().default(""),
      country: z.string().default(""),
    })
    .nullish(),
  founders: z.array(FounderSchema).optional(),
  press_mentions: z.array(PressMentionSchema).optional(),
})

const DefaultMetaSchema = z.object({
  title_default: z.string(),
  title_template: z.string(),
  description_fallback: z.string(),
  keywords: z.array(z.string()).default([]),
  og_image_url: z.string().nullish(),
  twitter_handle: z.string().nullish(),
  locale: z.string().default("en_IN"),
})

const SaveSchema = z.object({
  master_enabled: z.boolean().optional(),
  seo_enabled: z.boolean().optional(),
  geo_enabled: z.boolean().optional(),
  aeo_enabled: z.boolean().optional(),
  llmo_enabled: z.boolean().optional(),
  eeo_enabled: z.boolean().optional(),
  kgo_enabled: z.boolean().optional(),
  reo_enabled: z.boolean().optional(),
  sgeo_enabled: z.boolean().optional(),

  brand: BrandSchema.optional(),
  default_meta: DefaultMetaSchema.optional(),

  robots: z
    .object({
      disallow_paths: z.array(z.string()).default([]),
      sitemap_url: z.string().nullish(),
    })
    .optional(),

  sitemap_shards: z
    .object({
      static: z.boolean(),
      products: z.boolean(),
      taxonomy: z.boolean(),
      knowledge: z.boolean(),
    })
    .optional(),

  entity: z
    .object({
      same_as: z.array(z.string()).default([]),
      knows_about: z.array(z.string()).default([]),
      services: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            url: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),

  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .optional(),
  default_product_faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .optional(),
  default_category_faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .optional(),

  citations: z
    .object({
      author: z.string().nullish(),
      reviewer: z.string().nullish(),
      last_updated: z.string().nullish(),
    })
    .optional(),

  llms_txt: z
    .object({
      short_md: z.string(),
      full_md: z.string(),
    })
    .optional(),

  bot_policy: z
    .object({
      retrieval_bots: z.enum(["allow", "deny"]),
      training_bots: z.enum(["allow", "deny"]),
      scraper_bots: z.enum(["allow", "deny"]),
      overrides: z.record(z.string(), z.enum(["allow", "deny"])).default({}),
    })
    .optional(),

  retrieval: z
    .object({
      prefer_h2_breaks: z.boolean(),
      chunk_size_tokens: z.number().int().positive(),
      emit_jsonl_export: z.boolean(),
    })
    .optional(),

  generative: z
    .object({
      question_intent_keywords: z.array(z.string()).default([]),
      summary_paragraph: z.string().default(""),
      source_attribution_text: z.string().default(""),
    })
    .optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const view = await ovo.getSettingsView()
    res.json(view)
  } catch (err) {
    logger.error("ovo.getSettingsView failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "settings_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = SaveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  try {
    const view = await ovo.saveSettings(parsed.data, {
      updated_by_user_id: adminUserId,
    })
    // Best-effort cache bust on the storefront. Failure here must not
    // fail the save — the next ISR window will pick up the change
    // anyway. Fires async (we don't await the response body).
    fireRevalidate().catch((err) => {
      logger.warn("ovo: revalidate fan-out failed", { error: err })
    })
    res.json(view)
  } catch (err) {
    logger.error("ovo.saveSettings failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "settings_save_failed" })
  }
}

async function fireRevalidate(): Promise<void> {
  // Optional best-effort cache bust on the operator's storefront. No-op
  // unless both env vars are set — the plugin makes no assumption about
  // the storefront framework or its paths.
  const url = process.env.OVO_STOREFRONT_REVALIDATE_URL || process.env.STOREFRONT_REVALIDATE_URL
  const secret =
    process.env.OVO_REVALIDATE_SECRET || process.env.REVALIDATE_SECRET
  if (!url || !secret) return
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({
      tags: ["ovo-config"],
      // Universal SEO surfaces only — no storefront-specific marketing
      // paths. Operators that want more can revalidate by tag on their
      // side using the "ovo-config" tag above.
      paths: [
        "/",
        "/robots.txt",
        "/sitemap.xml",
        "/llms.txt",
        "/llms-full.txt",
      ],
    }),
  })
}
