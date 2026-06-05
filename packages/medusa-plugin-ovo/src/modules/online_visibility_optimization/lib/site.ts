/**
 * Resolve the public site URL used for sitemap discovery, audits, and
 * URL-index inspection. Reads only env vars (no hardcoded brand) so a
 * clean install never points at a third party. Returns "" when nothing
 * is configured — callers degrade to an honest "add a sitemap" state.
 *
 * Kept in its own dependency-free module so it can be unit-tested
 * without loading the Medusa framework via the service.
 */
export function resolveDefaultSiteUrl(): string {
  return (
    process.env.OVO_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.STOREFRONT_URL ||
    ""
  )
}
