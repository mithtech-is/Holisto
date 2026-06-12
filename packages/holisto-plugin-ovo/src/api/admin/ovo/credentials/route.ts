import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../modules/online_visibility_optimization"
import { logger } from "../../../../utils/logger"

/**
 * GET  /admin/ovo/credentials       — masked snapshot
 * POST /admin/ovo/credentials       — paste / clear credentials
 *
 * The GET response NEVER includes plaintext. Per credential it reports:
 *   { configured, source: "db" | "env" | "none", last4 }
 * Plus the two `_site_url` plaintext values (not secrets).
 *
 * The POST accepts plaintext strings; the service encrypts before
 * persisting. Passing an explicit `null` clears the DB row (and falls
 * back to env). Omitting a field leaves the existing value unchanged.
 *
 * Auth: bound at `src/api/middlewares.ts` to the admin-session cookie.
 */

const SaveSchema = z.object({
  /** Full single-line service-account JSON ({"type":"service_account",...}).
   *  Empty string is rejected; pass null to clear. */
  gsc_service_account_json: z.string().min(50).nullable().optional(),
  /** Bing Webmaster API key. */
  bing_api_key: z.string().min(8).nullable().optional(),
  /** OpenAI API key (`sk-...`). Used by Phase 4 AI-citation tracker. */
  openai_api_key: z.string().min(20).nullable().optional(),
  /** Anthropic API key (`sk-ant-...`). */
  anthropic_api_key: z.string().min(20).nullable().optional(),
  /** Perplexity API key (`pplx-...`). */
  perplexity_api_key: z.string().min(20).nullable().optional(),
  /** Google AI Studio (Gemini) API key. */
  google_ai_api_key: z.string().min(20).nullable().optional(),
  /** Phase 11 — Yandex Webmaster OAuth token (from oauth.yandex.com).
   *  Auto-discovery resolves user_id + host_id from the token. */
  yandex_oauth_token: z.string().min(20).nullable().optional(),
  /** Manual overrides — only set these when Yandex auto-discovery
   *  fails to match the configured site URL (rare). */
  yandex_user_id: z.string().min(1).nullable().optional(),
  yandex_host_id: z.string().min(1).nullable().optional(),
  /** Phase 12 — Chrome UX Report API key (Google Cloud API key
   *  with the CrUX API enabled). */
  crux_api_key: z.string().min(20).nullable().optional(),
  // SpaceSerp credential removed — see Migration20260515220000.
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const view = await ovo.getApiCredentialsView()
    res.json(view)
  } catch (err) {
    logger.error("ovo.credentials.get failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "credentials_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = SaveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  // Light JSON-shape validation for the GSC service account: most
  // operator paste errors are forgetting the surrounding braces or
  // pasting just the email. Catching it here gives a useful error
  // before the cipher write.
  if (typeof parsed.data.gsc_service_account_json === "string") {
    try {
      const json = JSON.parse(parsed.data.gsc_service_account_json)
      if (!json.client_email || !json.private_key) {
        return res.status(400).json({
          message:
            'gsc_service_account_json must contain "client_email" and "private_key"',
        })
      }
    } catch {
      return res.status(400).json({
        message: "gsc_service_account_json must be valid JSON",
      })
    }
  }

  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const adminUserId =
    (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
      ?.actor_id ?? null
  try {
    const view = await ovo.saveApiCredentials({
      ...parsed.data,
      updated_by_user_id: adminUserId,
    })
    res.json(view)
  } catch (err) {
    logger.error("ovo.credentials.save failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "credentials_save_failed" })
  }
}
