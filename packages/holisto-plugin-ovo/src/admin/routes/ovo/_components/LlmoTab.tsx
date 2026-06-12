import React, { useEffect, useState } from "react"
import {
  Button,
  Heading,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  loadOvo,
  saveOvo,
  type BotPolicy,
  type LlmsTxt,
  type OvoSettingView,
} from "./types"

/**
 * LLMO tab — /llms.txt + /llms-full.txt content (replaces the static
 * files at apps/storefront/public/llms*.txt) and per-bot allow/deny
 * policy.
 *
 * The bot taxonomy is split three ways:
 *   - retrieval bots fetch live pages to answer a user question
 *     (Perplexity, OAI-SearchBot, Google-Extended in answer mode).
 *     Allowing them is usually high leverage.
 *   - training bots scrape to retrain a base model (GPTBot, ClaudeBot,
 *     CCBot, …). Allowing them embeds your brand into future model
 *     generations.
 *   - scraper bots are SEO-resellers and content farmers (SemrushBot,
 *     AhrefsBot, MJ12bot). Denying them is housekeeping; they respect
 *     robots < 50 % of the time but the intent-signal helps legal.
 *
 * Per-UA overrides let you e.g. allow training bots in general but
 * deny GPTBot specifically.
 */
const KNOWN_RETRIEVAL_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "YouBot",
  "Google-Extended",
]
const KNOWN_TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "cohere-ai",
  "Bytespider",
  "meta-externalagent",
  "CCBot",
  "Applebot-Extended",
  "Amazonbot",
  "DuckAssistBot",
  "Diffbot",
]
const KNOWN_SCRAPER_BOTS = ["SemrushBot", "AhrefsBot", "MJ12bot", "DotBot"]

const LlmoTab: React.FC = () => {
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

  const llms: LlmsTxt = draft.llms_txt ?? { short_md: "", full_md: "" }
  const policy: BotPolicy =
    draft.bot_policy ?? {
      retrieval_bots: "allow",
      training_bots: "allow",
      scraper_bots: "deny",
      overrides: {},
    }

  const setLlms = (patch: Partial<LlmsTxt>) =>
    setDraft({ ...draft, llms_txt: { ...llms, ...patch } })
  const setPolicy = (patch: Partial<BotPolicy>) =>
    setDraft({ ...draft, bot_policy: { ...policy, ...patch } })
  const setOverride = (ua: string, value: "allow" | "deny" | "default") => {
    const overrides = { ...policy.overrides }
    if (value === "default") delete overrides[ua]
    else overrides[ua] = value
    setPolicy({ overrides })
  }

  const save = async () => {
    setSaving(true)
    try {
      const next = await saveOvo({ llms_txt: llms, bot_policy: policy })
      setDraft(next)
      toast.success("Saved", {
        description: "/llms.txt + /robots.txt will reflect the change shortly.",
      })
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const renderBotRow = (
    ua: string,
    fallback: "allow" | "deny",
  ) => {
    const value = policy.overrides[ua] ?? "default"
    return (
      <div
        key={ua}
        className="flex items-center justify-between rounded-md border border-ui-border-base px-3 py-2"
      >
        <Text size="small" className="font-mono">
          {ua}
        </Text>
        <Select
          value={value}
          onValueChange={(v) =>
            setOverride(ua, v as "allow" | "deny" | "default")
          }
        >
          <Select.Trigger className="w-32">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="default">Inherit ({fallback})</Select.Item>
            <Select.Item value="allow">Allow</Select.Item>
            <Select.Item value="deny">Deny</Select.Item>
          </Select.Content>
        </Select>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Heading level="h2">/llms.txt</Heading>
        <Text className="text-ui-fg-muted">
          Short brief — the file LLM retrievers prefer when they want a
          one-shot summary of your site.
        </Text>
        <Textarea
          rows={14}
          value={llms.short_md}
          onChange={(e) => setLlms({ short_md: e.target.value })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">/llms-full.txt</Heading>
        <Text className="text-ui-fg-muted">
          Long-form brief — used by retrievers that want full context.
        </Text>
        <Textarea
          rows={20}
          value={llms.full_md}
          onChange={(e) => setLlms({ full_md: e.target.value })}
        />
      </section>

      <section className="flex flex-col gap-4">
        <Heading level="h2">Bot policy</Heading>
        <Text className="text-ui-fg-muted">
          Default allow/deny per bot category. Per-UA overrides below
          shadow the category default.
        </Text>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex items-start gap-3">
            <Switch
              checked={policy.retrieval_bots === "allow"}
              onCheckedChange={(checked) =>
                setPolicy({ retrieval_bots: checked ? "allow" : "deny" })
              }
            />
            <div>
              <Label>Retrieval bots</Label>
              <Text size="small" className="text-ui-fg-muted">
                Live answer fetchers (Perplexity, OAI-SearchBot, …).
              </Text>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              checked={policy.training_bots === "allow"}
              onCheckedChange={(checked) =>
                setPolicy({ training_bots: checked ? "allow" : "deny" })
              }
            />
            <div>
              <Label>Training bots</Label>
              <Text size="small" className="text-ui-fg-muted">
                Model-training crawlers (GPTBot, ClaudeBot, …).
              </Text>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              checked={policy.scraper_bots === "allow"}
              onCheckedChange={(checked) =>
                setPolicy({ scraper_bots: checked ? "allow" : "deny" })
              }
            />
            <div>
              <Label>Scraper bots</Label>
              <Text size="small" className="text-ui-fg-muted">
                SEO-resellers + content farmers.
              </Text>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Heading level="h3">Retrieval bots — overrides</Heading>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {KNOWN_RETRIEVAL_BOTS.map((ua) =>
              renderBotRow(ua, policy.retrieval_bots),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Heading level="h3">Training bots — overrides</Heading>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {KNOWN_TRAINING_BOTS.map((ua) =>
              renderBotRow(ua, policy.training_bots),
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Heading level="h3">Scraper bots — overrides</Heading>
          <Text size="small" className="text-ui-fg-muted">
            SEO-resellers + content farmers. Default is `deny`; flip
            individual bots to `allow` only if you have a specific
            reason (e.g. a rank-tracking subscription).
          </Text>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {KNOWN_SCRAPER_BOTS.map((ua) =>
              renderBotRow(ua, policy.scraper_bots),
            )}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} isLoading={saving}>
          Save LLMO settings
        </Button>
      </div>
    </div>
  )
}

export default LlmoTab
