import { Module } from "@medusajs/framework/utils"
import OvoService from "./service"

/**
 * Online Visibility Optimization (OVO).
 *
 * Single module that unifies SEO, GEO, AEO, LLMO, EEO, KGO, REO, and
 * SGEO controls. Owns one settings row (singleton); the storefront
 * fetches the public projection and uses it to drive metadata, JSON-LD,
 * robots, sitemap shards, and /llms.txt.
 *
 * Mirrors a singleton-settings shape
 * so admins iterate via one GET/POST flow.
 */
export const ONLINE_VISIBILITY_OPTIMIZATION_MODULE =
  "online_visibility_optimization"

export default Module(ONLINE_VISIBILITY_OPTIMIZATION_MODULE, {
  service: OvoService,
})

export { OvoService }
export { OVO_ENTITY_TYPES, type OvoEntityType } from "./service"
export type {
  SubmissionDestination,
  SubmissionDestinationKey,
  SubmissionDestinationStats,
  SubmissionResult,
  SubmissionAction,
  SubmissionStatus,
  SubmissionDayBucket,
} from "./service"
