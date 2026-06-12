import React, { useEffect, useState } from "react"
import {
  Button,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  loadOvo,
  saveOvo,
  type GenerativeConfig,
  type OvoSettingView,
} from "./types"

/**
 * GEO / SGEO tab — generative-search shaping.
 *
 * The summary paragraph is the single most-cited piece of copy for
 * Google's AI Overviews + Perplexity citations. Treat it like an
 * elevator pitch: 2–3 sentences, factual, no marketing fluff.
 *
 * Question-intent keywords drive section headings on landing pages —
 * adding "how to choose the right product" surfaces a matching
 * H2 that the page must answer. Source attribution gets appended to
 * paragraphs the AI Overview lifts so retrievers can re-cite the
 * canonical URL.
 */
const GeoSgeTab: React.FC = () => {
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

  const gen: GenerativeConfig =
    draft.generative ?? {
      question_intent_keywords: [],
      summary_paragraph: "",
      source_attribution_text: "",
    }

  const setGen = (patch: Partial<GenerativeConfig>) =>
    setDraft({ ...draft, generative: { ...gen, ...patch } })

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({ generative: gen })
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
      <Heading level="h2">Generative search shaping</Heading>
      <Text className="text-ui-fg-muted">
        Used by AI Overviews / SGE / Perplexity to summarise this site.
      </Text>
      <div className="flex flex-col gap-1">
        <Label htmlFor="summary_paragraph">
          Canonical summary paragraph (2–3 sentences)
        </Label>
        <Textarea
          id="summary_paragraph"
          rows={4}
          value={gen.summary_paragraph}
          onChange={(e) => setGen({ summary_paragraph: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="intent_keywords">
          Question-intent keywords (one per line)
        </Label>
        <Textarea
          id="intent_keywords"
          rows={6}
          value={gen.question_intent_keywords.join("\n")}
          onChange={(e) =>
            setGen({
              question_intent_keywords: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="attribution">Source attribution text</Label>
        <Input
          id="attribution"
          placeholder="Source: example.com — official platform page."
          value={gen.source_attribution_text}
          onChange={(e) => setGen({ source_attribution_text: e.target.value })}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save generative settings
        </Button>
      </div>
    </div>
  )
}

export default GeoSgeTab
