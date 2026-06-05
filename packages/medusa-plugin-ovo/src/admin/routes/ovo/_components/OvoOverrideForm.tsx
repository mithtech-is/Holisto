import React, { useEffect, useState } from "react"
import { Button, Input, Label, Text, Textarea, toast } from "@medusajs/ui"

type OvoOverrideFormProps = {
  entityType: string
  entityId: string
  defaultPath?: string
}

const EMPTY = {
  seo_title: "",
  meta_description: "",
  canonical_url: "",
  robots: "",
  jsonld: "",
  faq: "",
}

const OvoOverrideForm: React.FC<OvoOverrideFormProps> = ({
  entityType,
  entityId,
  defaultPath = "",
}) => {
  const [draft, setDraft] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!entityType || !entityId) return
    setLoading(true)
    fetch(`/admin/ovo/overrides/${entityType}/${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) return
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
      .finally(() => setLoading(false))
  }, [entityType, entityId])

  const setField = (key: keyof typeof EMPTY, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        entity_type: entityType,
        entity_id: entityId,
        path: defaultPath || entityId,
        seo_title: draft.seo_title || null,
        meta_description: draft.meta_description || null,
        canonical_url: draft.canonical_url || null,
        robots: draft.robots || null,
      }
      if (draft.jsonld.trim()) body.jsonld = JSON.parse(draft.jsonld)
      if (draft.faq.trim()) body.faq = JSON.parse(draft.faq)

      const r = await fetch(
        `/admin/ovo/overrides/${entityType}/${encodeURIComponent(entityId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        Per-URL override
      </Text>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>SEO title</Label>
          <Input
            value={draft.seo_title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setField("seo_title", e.target.value)
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Canonical URL</Label>
          <Input
            value={draft.canonical_url}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setField("canonical_url", e.target.value)
            }
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Meta description</Label>
        <Textarea
          rows={3}
          value={draft.meta_description}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setField("meta_description", e.target.value)
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>JSON-LD override</Label>
          <Textarea
            rows={6}
            value={draft.jsonld}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setField("jsonld", e.target.value)
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>FAQ override</Label>
          <Textarea
            rows={6}
            value={draft.faq}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setField("faq", e.target.value)
            }
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
