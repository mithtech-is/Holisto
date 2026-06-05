import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 1 of OVO keyword domination — adds `ovo_seo_keyword_group`,
 * the funnel-staged taxonomy that the previously-flat
 * `ovo_seo_keyword_target` list will roll up under.
 *
 * Indexing strategy:
 *   - `(slug)` UNIQUE partial — slugs are deep-linked from admin
 *     (`/app/ovo?tab=keywords&group=:slug`) and must be unique among
 *     live (non-soft-deleted) rows. Re-using a slug after delete is
 *     allowed.
 *   - `(parent_group_id)` — for the sidebar tree query "give me
 *     everything that rolls up under X".
 *   - `(funnel_stage, is_pillar)` — for the Groups Performance
 *     dashboard which slices the leaderboard by funnel position.
 *
 * `down()` drops the table outright. Groups are operator-curated
 * editorial data; if we ever need to roll back this phase, recreating
 * the handful of seeded groups is a 5-minute job.
 *
 * No FK to `parent_group_id` — we soft-resolve in the service to
 * avoid CASCADE surprises when an operator deletes a parent group
 * that still has children. The service hands children back to the
 * "Uncategorized" virtual root in that case.
 */
export class Migration20260516100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_keyword_group" (
        "id" text NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "description" text NULL,
        "color" text NULL,
        "icon" text NULL,
        "parent_group_id" text NULL,
        "priority" integer NOT NULL DEFAULT 2,
        "sort_order" integer NOT NULL DEFAULT 0,
        "intent" text NULL,
        "funnel_stage" text NULL,
        "is_pillar" boolean NOT NULL DEFAULT false,
        "audit_weight" double precision NOT NULL DEFAULT 1.0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_keyword_group_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "chk_ovo_kw_group_priority" CHECK ("priority" BETWEEN 1 AND 5),
        CONSTRAINT "chk_ovo_kw_group_audit_weight" CHECK ("audit_weight" BETWEEN 0.1 AND 5.0),
        CONSTRAINT "chk_ovo_kw_group_funnel" CHECK ("funnel_stage" IS NULL OR "funnel_stage" IN ('TOFU','MOFU','BOFU')),
        CONSTRAINT "chk_ovo_kw_group_intent" CHECK ("intent" IS NULL OR "intent" IN ('transactional','informational','commercial','navigational','comparison'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_keyword_group_slug"
        ON "ovo_seo_keyword_group" ("slug")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_group_parent"
        ON "ovo_seo_keyword_group" ("parent_group_id")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_group_funnel_pillar"
        ON "ovo_seo_keyword_group" ("funnel_stage", "is_pillar")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_group_deleted_at"
        ON "ovo_seo_keyword_group" ("deleted_at")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_keyword_group" CASCADE;`)
  }
}
