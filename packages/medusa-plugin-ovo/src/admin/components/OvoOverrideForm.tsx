import React, { useEffect, useState } from "react"
import { Button, Input, Label, Text, Textarea, toast } from "@medusajs/ui"

/**
 * Per-URL / per-entity override editor.
 *
 * Loads the current override for `(entity_type, entity_id)` from
 * `GET /admin/ovo/overrides/:entity_type/:entity_id` and saves edits
 * back via `POST` to the same path. Used by the Pages tab (path-keyed
 * overrides) and reusable by product/category widgets.
 *
 * Supported override fields (each one layers on top of the site-wide
 * defaults; an empty field means "inherit the default"):
 *   - SEO title
 *   - Meta description
 *   - Canonical URL
 *   - Robots directive (e.g. `noindex, nofollow`)
 *   - JSON-LD override (raw JSON)
 *   - FAQ override (raw JSON array of { question, answer })
 */
export type OvoOverrideFormProps = {
  entity_type: string
  entity_id: string
  entity_label?: string
}

type Draft = {
  seo_title: string
  meta_description: string
  canonical_url: string
  robots: string
  jsonld: string
  faq: string
}

const EMPTY: Draft = {
  seo_title: "",
  meta_description: "",
  canonical_url: "",
  robots: "",
  jsonld: "",
  faq: "",
}

export const OvoOverrideForm: React.FC<OvoOverrideFormProps> = ({
  entity_type,
  entity_id,
  entity_label,
}) => {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!entity_type || !entity_id) return
    let cancelled = false
    setLoading(true)
    setDraft(EMPTY)
    fetch(
      `/admin/ovo/overrides/${entity_type}/${encodeURIComponent(entity_id)}`,
      { credentials: "include" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (cancelled || !row) return
        setDraft({
          seo_title: row.seo_title ?? "",
          meta_description: row.meta_description ?? "",
          canonical_url: row.canonical_url ?? "",
          robots: row.robots ?? "",
          jsonld: row.jsonld ? JSON.stringify(row.jsonld, null, 2) : "",
          faq: row.faq ? JSON.stringify(row.faq, null, 2) : "",
        })
      })
      .catch(() => toast.error("Override load failed"))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entity_type, entity_id])

  const setField = (key: keyof Draft, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        entity_type,
        entity_id,
        seo_title: draft.seo_title || null,
        meta_description: draft.meta_description || null,
        canonical_url: draft.canonical_url || null,
        robots: draft.robots || null,
      }
      if (draft.jsonld.trim()) {
        try {
          body.jsonld = JSON.parse(draft.jsonld)
        } catch {
          throw new Error("JSON-LD override is not valid JSON.")
        }
      } else {
        body.jsonld = null
      }
      if (draft.faq.trim()) {
        try {
          body.faq = JSON.parse(draft.faq)
        } catch {
          throw new Error("FAQ override is not valid JSON.")
        }
      } else {
        body.faq = null
      }
      const r = await fetch(
        `/admin/ovo/overrides/${entity_type}/${encodeURIComponent(entity_id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      )
      if (!r.ok) throw new Error(await r.text())
      toast.success("Override saved")
    } catch (err) {
      toast.error((err as Error).message || "Override save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-ui-border-base p-4">
      <Text size="small" weight="plus">
        Per-URL override{entity_label ? ` — ${entity_label}` : ""}
      </Text>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>SEO title</Label>
          <Input
            value={draft.seo_title}
            placeholder="Inherit site default"
            onChange={(e) => setField("seo_title", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Canonical URL</Label>
          <Input
            value={draft.canonical_url}
            placeholder="https://your-domain.example/path"
            onChange={(e) => setField("canonical_url", e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Meta description</Label>
        <Textarea
          rows={3}
          value={draft.meta_description}
          placeholder="Inherit site default"
          onChange={(e) => setField("meta_description", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Robots directive</Label>
        <Input
          value={draft.robots}
          placeholder="e.g. noindex, nofollow (leave empty to inherit)"
          onChange={(e) => setField("robots", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>JSON-LD override</Label>
          <Textarea
            rows={6}
            value={draft.jsonld}
            placeholder='{ "@context": "https://schema.org", ... }'
            onChange={(e) => setField("jsonld", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>FAQ override</Label>
          <Textarea
            rows={6}
            value={draft.faq}
            placeholder='[{ "question": "…", "answer": "…" }]'
            onChange={(e) => setField("faq", e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving || loading}>
          Save override
        </Button>
      </div>
    </div>
  )
}

export default OvoOverrideForm
