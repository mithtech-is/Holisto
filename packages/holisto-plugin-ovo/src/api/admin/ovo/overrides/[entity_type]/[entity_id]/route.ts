import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
  OVO_ENTITY_TYPES,
  type OvoEntityType,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET    /admin/ovo/overrides/:entity_type/:entity_id
 * POST   /admin/ovo/overrides/:entity_type/:entity_id
 * DELETE /admin/ovo/overrides/:entity_type/:entity_id
 *
 * Per-entity OVO override CRUD. Backs the product + category admin
 * widgets. Responses are auth-gated by the existing /admin/ovo*
 * middleware matcher.
 *
 * GET:    returns the override row, or `null` if none exists.
 * POST:   upserts. Body shape mirrors `OvoOverride` columns; any
 *         omitted key is left untouched on update.
 * DELETE: clears (soft-deletes) the override — storefront falls back
 *         to OVO defaults on the next ISR window.
 */

/**
 * Each entry must be a JSON object (typically with `@context` +
 * `@type`). We don't validate against the schema.org spec — admins
 * may legitimately use experimental types — but we DO require it to
 * be an object so the storefront's `JSON.stringify` can't blow up.
 */
const JsonLdEntrySchema = z
  .record(z.string(), z.unknown())
  .refine((o) => typeof o["@type"] === "string" && o["@type"].length > 0, {
    message: "Each JSON-LD block must have a non-empty `@type` field",
  })

const SaveSchema = z.object({
  seo_title: z.string().nullish(),
  seo_description: z.string().nullish(),
  og_image_url: z.string().nullish(),
  canonical_url: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
  noindex: z.boolean().optional(),
  faq: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .nullish(),
  inherit_default_faq: z.boolean().optional(),
  inherit_default_json_ld: z.boolean().optional(),
  summary_paragraph: z.string().nullish(),
  author: z.string().nullish(),
  reviewer: z.string().nullish(),
  last_updated: z.string().nullish(),
  /** Array of arbitrary JSON-LD blocks. Each becomes its own
   *  `<script type="application/ld+json">` on the entity's page. */
  custom_json_ld: z.array(JsonLdEntrySchema).nullish(),
})

function parseEntityType(req: MedusaRequest): OvoEntityType | null {
  const t = (req.params as any).entity_type as string
  return (OVO_ENTITY_TYPES as readonly string[]).includes(t)
    ? (t as OvoEntityType)
    : null
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const entity_type = parseEntityType(req)
  if (!entity_type) {
    return res.status(400).json({ message: "invalid entity_type" })
  }
  const entity_id = (req.params as any).entity_id as string
  if (!entity_id) {
    return res.status(400).json({ message: "entity_id required" })
  }

  try {
    const row = await ovo.getOverride(entity_type, entity_id)
    res.json(row ?? null)
  } catch (err) {
    logger.error("ovo.getOverride failed", { error: err, entity_type, entity_id })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "override_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const entity_type = parseEntityType(req)
  if (!entity_type) {
    return res.status(400).json({ message: "invalid entity_type" })
  }
  const entity_id = (req.params as any).entity_id as string
  if (!entity_id) {
    return res.status(400).json({ message: "entity_id required" })
  }

  const parsed = SaveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  try {
    const row = await ovo.saveOverride(entity_type, entity_id, parsed.data, {
      updated_by_user_id: adminUserId,
    })
    // Best-effort cache bust on the storefront. Failure here must not
    // fail the save — the next ISR window picks up the change anyway.
    fireRevalidate(entity_type, entity_id, row).catch((err) => {
      logger.warn("ovo.override revalidate fan-out failed", { error: err })
    })
    res.json(row)
  } catch (err) {
    logger.error("ovo.saveOverride failed", { error: err, entity_type, entity_id })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "override_save_failed" })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const entity_type = parseEntityType(req)
  if (!entity_type) {
    return res.status(400).json({ message: "invalid entity_type" })
  }
  const entity_id = (req.params as any).entity_id as string
  if (!entity_id) {
    return res.status(400).json({ message: "entity_id required" })
  }

  try {
    await ovo.clearOverride(entity_type, entity_id)
    fireRevalidate(entity_type, entity_id, null).catch((err) => {
      logger.warn("ovo.override revalidate fan-out failed", { error: err })
    })
    res.json({ ok: true })
  } catch (err) {
    logger.error("ovo.clearOverride failed", { error: err, entity_type, entity_id })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "override_delete_failed" })
  }
}

/**
 * Tell the storefront to revalidate any cached page that depends on
 * this override. Best-effort — silent on missing env or failure.
 *
 * Path mapping is per-entity-type:
 *   - product:  / + /sitemap/products.xml
 *   - page:     the entity_id IS the path (e.g. /pricing), plus / + /sitemap/static.xml
 *   - category + everything else: / + /sitemap/taxonomy.xml
 */
async function fireRevalidate(
  entity_type: OvoEntityType,
  entity_id: string,
  _row: Record<string, unknown> | null,
): Promise<void> {
  const url = process.env.OVO_STOREFRONT_REVALIDATE_URL || process.env.STOREFRONT_REVALIDATE_URL
  const secret =
    process.env.OVO_REVALIDATE_SECRET || process.env.REVALIDATE_SECRET
  if (!url || !secret) return

  let paths: string[]
  if (entity_type === "product") {
    paths = ["/", "/sitemap/products.xml"]
  } else if (entity_type === "page") {
    // For page overrides, the entity_id IS the URL path (e.g.
    // "/pricing" or "pricing"). Normalise the leading slash + the
    // static-sitemap shard so the override shows up in /sitemap.xml
    // on next ISR fetch.
    const pagePath = entity_id.startsWith("/")
      ? entity_id
      : `/${entity_id}`
    paths = [pagePath, "/", "/sitemap/static.xml"]
  } else {
    // category + every other entity_type — sweep the taxonomy.
    paths = ["/", "/sitemap/taxonomy.xml"]
  }

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({
      tags: ["ovo-config"],
      paths,
    }),
  })
}
