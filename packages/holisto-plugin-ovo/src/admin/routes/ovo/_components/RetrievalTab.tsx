import React, { useEffect, useState } from "react"
import {
  Button,
  Heading,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import {
  loadOvo,
  saveOvo,
  type OvoSettingView,
  type RetrievalConfig,
} from "./types"

/**
 * Retrieval (REO) tab — chunking hints + JSONL export flag.
 *
 * `prefer_h2_breaks` is a hint to content authoring (and to a future
 * markdown extractor) to keep semantic boundaries on H2s so a RAG
 * retriever's chunker doesn't bisect a paragraph mid-thought.
 *
 * `emit_jsonl_export` is the v2 hook — when on, the storefront will
 * expose `/store/export.jsonl` with one chunk per line for downstream
 * embedding consumers. Currently a no-op flag pending v2.
 */
const RetrievalTab: React.FC = () => {
  const [draft, setDraft] = useState<OvoSettingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOvo()
      .then(setDraft)
      .catch((err) => toast.error("Load failed", { description: (err as Error).message }))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !draft) return <Text>Loading…</Text>

  const reo: RetrievalConfig =
    draft.retrieval ?? {
      prefer_h2_breaks: true,
      chunk_size_tokens: 512,
      emit_jsonl_export: false,
    }

  const setReo = (patch: Partial<RetrievalConfig>) =>
    setDraft({ ...draft, retrieval: { ...reo, ...patch } })

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({ retrieval: reo })
      setDraft(next)
      toast.success("Saved")
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Heading level="h2">Retrieval optimization</Heading>
      <Text className="text-ui-fg-muted">
        Hints for RAG retrievers + downstream embedding consumers.
      </Text>

      <div className="flex items-start gap-3">
        <Switch
          id="prefer_h2_breaks"
          checked={reo.prefer_h2_breaks}
          onCheckedChange={(checked) =>
            setReo({ prefer_h2_breaks: !!checked })
          }
        />
        <div>
          <Label htmlFor="prefer_h2_breaks">Prefer H2 chunk breaks</Label>
          <Text size="small" className="text-ui-fg-muted">
            Tells the JSONL exporter (v2) and structured-content authors
            to keep chunks aligned on H2 boundaries.
          </Text>
        </div>
      </div>

      <div className="flex flex-col gap-1 max-w-xs">
        <Label htmlFor="chunk_size">Target chunk size (tokens)</Label>
        <Input
          id="chunk_size"
          type="number"
          min={128}
          max={2048}
          value={reo.chunk_size_tokens}
          onChange={(e) =>
            setReo({ chunk_size_tokens: Math.max(1, Number(e.target.value || 512)) })
          }
        />
      </div>

      {/*
        emit_jsonl_export is a v2-reserved no-op flag — the storefront
        does not yet expose /store/export.jsonl. The schema field stays
        (so saved-state round-trips), but we hide the toggle so the UI
        only surfaces controls that change behaviour today. Re-enable
        once the JSONL export route ships.
      */}

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save retrieval settings
        </Button>
      </div>
    </div>
  )
}

export default RetrievalTab
