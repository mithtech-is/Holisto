// @ts-nocheck
import crypto from "node:crypto"
import { MedusaService } from "@medusajs/framework/utils"
import { CommunicationAuditLog } from "./models/audit-log"
import { CommunicationBrandConfig } from "./models/brand-config"
import { CommunicationEventRule } from "./models/event-rule"
import { CommunicationMessageLog } from "./models/message-log"
import { CommunicationOtpRequest } from "./models/otp-request"
import { CommunicationProviderConfig } from "./models/provider-config"
import { CommunicationTemplate } from "./models/communication-template"
import { CommunicationWebhookEvent } from "./models/webhook-event"
import { decryptSecret, encryptSecret, maskSecret } from "./utils/crypto"
import { renderJsonTemplate, renderTemplate } from "./utils/render"
import {
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_EVENT_RULES,
  DEFAULT_SMS_TEMPLATES,
  DEFAULT_WHATSAPP_TEMPLATES,
} from "./seed/templates"
import * as SmtpProvider from "./providers/smtp.provider"
import * as Msg91Provider from "./providers/msg91.provider"
import * as PolyginProvider from "./providers/polygin.provider"

export type Channel = "email" | "sms" | "whatsapp"
export type AnyRecord = Record<string, any>

const DEFAULT_TENANT = "default"
const DEFAULT_SECRET = "communication-plugin-development-key"

function now() {
  return new Date()
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function normalizePhone(phone: string): string {
  const trimmed = String(phone || "").trim()
  if (trimmed.startsWith("+")) return trimmed
  return `+${trimmed.replace(/\D/g, "")}`
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

class CommunicationModuleService extends MedusaService({
  CommunicationAuditLog,
  CommunicationBrandConfig,
  CommunicationEventRule,
  CommunicationMessageLog,
  CommunicationOtpRequest,
  CommunicationProviderConfig,
  CommunicationTemplate,
  CommunicationWebhookEvent,
}) {
  protected readonly options_: AnyRecord
  protected readonly encryptionSecret_: string

  constructor(container: AnyRecord, options: AnyRecord = {}) {
    super(container)
    this.options_ = options
    this.encryptionSecret_ =
      options.encryptionSecret ||
      process.env.COMMUNICATION_ENCRYPTION_SECRET ||
      process.env.COMM_ENCRYPTION_SECRET ||
      DEFAULT_SECRET
  }

  async seedDefaults() {
    await this.ensureBrand()
    await this.refreshSystemSmsTemplates()
    await this.refreshSystemWhatsappTemplates()
    await this.refreshSystemEmailTemplates()
    for (const rule of DEFAULT_EVENT_RULES) {
      await this.upsertEventRule(rule as AnyRecord)
    }
  }

  async getBrandConfigView() {
    return this.ensureBrand()
  }

  async upsertBrandConfig(input: AnyRecord) {
    const existing = await this.ensureBrand()
    const next = await (this as any).updateCommunicationBrandConfigs({
      id: existing.id,
      ...input,
      tenant_key: existing.tenant_key || DEFAULT_TENANT,
    })
    await this.audit("brand.updated", "brand_config", existing.id, existing, next)
    return next
  }

  async getMsg91ConfigView() {
    const cfg = await this.getProviderConfig("sms", "msg91")
    return this.providerView(cfg, ["auth_key"])
  }

  async getMsg91ConfigDecrypted() {
    const cfg = await this.getProviderConfig("sms", "msg91")
    return this.providerDecrypted(cfg)
  }

  async upsertMsg91Config(input: AnyRecord) {
    return this.upsertProviderConfig("sms", "msg91", input, ["auth_key"])
  }

  async recordMsg91TestResult(ok: boolean, error: string | null) {
    return this.recordProviderTest("sms", "msg91", ok, error)
  }

  async getPolyginConfigView() {
    const cfg = await this.getProviderConfig("whatsapp", "polygin")
    const view = this.providerView(cfg, ["token", "dashboard_token"])
    return {
      ...view,
      token_set: Boolean(cfg?.secrets?.token),
      dashboard_token_set: Boolean(cfg?.secrets?.dashboard_token),
    }
  }

  async getPolyginConfigDecrypted() {
    const cfg = await this.getProviderConfig("whatsapp", "polygin")
    return this.providerDecrypted(cfg)
  }

  async upsertPolyginConfig(input: AnyRecord) {
    return this.upsertProviderConfig("whatsapp", "polygin", input, [
      "token",
      "dashboard_token",
    ])
  }

  async recordPolyginTestResult(ok: boolean, error: string | null) {
    return this.recordProviderTest("whatsapp", "polygin", ok, error)
  }

  async getEmailConfigView(provider = "smtp") {
    const cfg = await this.getProviderConfig("email", provider)
    return this.providerView(cfg, ["password", "api_key", "secret_access_key"])
  }

  async upsertEmailConfig(input: AnyRecord) {
    const provider = input.provider || "smtp"
    return this.upsertProviderConfig("email", provider, input, [
      "password",
      "api_key",
      "secret_access_key",
    ])
  }

  async recordEmailTestResult(provider: string, ok: boolean, error: string | null) {
    return this.recordProviderTest("email", provider || "smtp", ok, error)
  }

  async sendSms(input: { to: string; body: string; provider?: string; metadata?: AnyRecord }) {
    const provider = input.provider || "msg91"
    const cfg = await this.getProviderConfig("sms", provider)
    const recipient = normalizePhone(input.to)
    const log = await this.createMessageLog({
      channel: "sms",
      provider,
      recipient,
      to_phone: recipient,
      body: input.body,
      status: cfg?.enabled ? "sending" : "skipped",
      metadata: input.metadata || null,
      error: cfg?.enabled ? null : "SMS provider is disabled or not configured.",
    })
    if (!cfg?.enabled) {
      return { ok: false, reason: log.error, log }
    }
    const decrypted = this.providerDecrypted(cfg)
    const msg91Config: Msg91Provider.Msg91Config = {
      auth_key: decrypted.auth_key || "",
      sender_id: decrypted.sender_id || "COMM",
      default_template_id: decrypted.default_template_id || undefined,
      otp_template_id: decrypted.otp_template_id || undefined,
    }
    const result = await Msg91Provider.sendSms(msg91Config, {
      to: recipient,
      body: input.body,
    })
    const updated = await (this as any).updateCommunicationMessageLogs({
      id: log.id,
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.provider_message_id || null,
      error: result.error || null,
    })
    return { ok: result.ok, message_id: updated.id, provider_message_id: result.provider_message_id, log: updated }
  }

  async sendWhatsapp(input: {
    to: string
    text?: string
    template_slug?: string
    variables?: AnyRecord
    provider?: string
    metadata?: AnyRecord
  }) {
    const provider = input.provider || "polygin"
    const cfg = await this.getProviderConfig("whatsapp", provider)
    const recipient = normalizePhone(input.to)
    const body = input.text || (input.template_slug ? await this.renderWhatsappBody(input.template_slug, input.variables || {}) : "")
    const log = await this.createMessageLog({
      channel: "whatsapp",
      provider,
      template_slug: input.template_slug || null,
      recipient,
      to_phone: recipient,
      body,
      status: cfg?.enabled ? "sending" : "skipped",
      metadata: input.metadata || null,
      error: cfg?.enabled ? null : "WhatsApp provider is disabled or not configured.",
    })
    if (!cfg?.enabled) {
      return { ok: false, reason: log.error, log }
    }
    const decrypted = this.providerDecrypted(cfg)
    const polyginConfig: PolyginProvider.PolyginConfig = {
      token: decrypted.token || "",
      dashboard_token: decrypted.dashboard_token || undefined,
      sender_phone: decrypted.sender_phone || recipient,
      test_phone: decrypted.test_phone || undefined,
    }
    let result: PolyginProvider.SendWhatsappResult
    if (input.template_slug) {
      const template = await this.getTemplateBySlug("whatsapp", input.template_slug)
      const brand = await this.ensureBrand()
      const components = template?.components
        ? renderJsonTemplate(template.components, { ...input.variables, brand })
        : undefined
      result = await PolyginProvider.sendWhatsappTemplate(polyginConfig, {
        to: recipient,
        template_name: template?.name || input.template_slug,
        language: template?.language || "en_US",
        components: components || [],
      })
    } else {
      result = await PolyginProvider.sendWhatsappMessage(polyginConfig, {
        to: recipient,
        text: body,
      })
    }
    const updated = await (this as any).updateCommunicationMessageLogs({
      id: log.id,
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.provider_message_id || null,
      error: result.error || null,
    })
    return { ok: result.ok, message_id: updated.id, provider_message_id: result.provider_message_id, log: updated }
  }

  async sendEmail(input: {
    to: string
    subject: string
    html?: string
    text?: string
    provider?: string
    metadata?: AnyRecord
  }) {
    const provider = input.provider || "smtp"
    const cfg = await this.getProviderConfig("email", provider)
    const log = await this.createMessageLog({
      channel: "email",
      provider,
      recipient: input.to,
      to_email: input.to,
      subject: input.subject,
      body: input.html || input.text || "",
      status: cfg?.enabled ? "sending" : "skipped",
      metadata: input.metadata || null,
      error: cfg?.enabled ? null : "Email provider is disabled or not configured.",
    })
    if (!cfg?.enabled) return { ok: false, reason: log.error, log }
    if (provider === "smtp") {
      const decrypted = this.providerDecrypted(cfg)
      const smtpConfig: SmtpProvider.SmtpConfig = {
        host: decrypted.host || "",
        port: Number(decrypted.port) || 587,
        username: decrypted.username || "",
        password: decrypted.password || "",
        from_email: decrypted.from_email || "",
        from_name: decrypted.from_name || undefined,
        reply_to: decrypted.reply_to || undefined,
        security_type: (decrypted.security_type as "tls" | "ssl" | "none") || "tls",
      }
      const result = await SmtpProvider.sendEmailWithSmtp(smtpConfig, {
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text || (input.html ? undefined : input.subject),
      })
      const updated = await (this as any).updateCommunicationMessageLogs({
        id: log.id,
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.provider_message_id || null,
        error: result.error || null,
      })
      return { ok: result.ok, message_id: updated.id, provider_message_id: result.provider_message_id, log: updated }
    }
    return { ok: true, message_id: log.id, log }
  }

  async listSmsTemplatesView(filters: AnyRecord = {}) {
    return this.listTemplatesView("sms", filters)
  }

  async listSmsTemplates(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listCommunicationTemplates({ ...filters, channel: "sms" }, config)
  }

  async deleteSmsTemplates(id: string) {
    return (this as any).deleteCommunicationTemplates(id)
  }

  async listWhatsappTemplatesView(filters: AnyRecord = {}) {
    const rows = await this.listTemplatesView("whatsapp", filters)
    return rows.map((row: AnyRecord) => this.withWhatsappAliases(row))
  }

  async listWhatsappTemplates(filters: AnyRecord = {}, config: AnyRecord = {}) {
    const normalized = { ...filters, channel: "whatsapp" }
    if (Array.isArray(normalized.slug)) {
      normalized.slug = normalized.slug
    }
    return (this as any).listCommunicationTemplates(normalized, config)
  }

  async deleteWhatsappTemplates(id: string) {
    return (this as any).deleteCommunicationTemplates(id)
  }

  async getSmsTemplateBySlug(slug: string) {
    return this.getTemplateBySlug("sms", slug)
  }

  async getWhatsappTemplateBySlug(slug: string) {
    const row = await this.getTemplateBySlug("whatsapp", slug)
    return row ? this.withWhatsappAliases(row) : null
  }

  async upsertSmsTemplate(input: AnyRecord) {
    return this.upsertTemplate("sms", input)
  }

  async upsertWhatsappTemplate(input: AnyRecord) {
    const row = await this.upsertTemplate("whatsapp", {
      ...input,
      provider_status: input.provider_status || input.polygin_status,
      provider_template_id: input.provider_template_id || input.polygin_template_id,
    })
    return this.withWhatsappAliases(row)
  }

  async refreshSystemSmsTemplates() {
    return this.refreshTemplates("sms", DEFAULT_SMS_TEMPLATES)
  }

  async refreshSystemWhatsappTemplates() {
    return this.refreshTemplates("whatsapp", DEFAULT_WHATSAPP_TEMPLATES)
  }

  async refreshSystemEmailTemplates() {
    return this.refreshTemplates("email", DEFAULT_EMAIL_TEMPLATES)
  }

  async getWhatsappTemplatePreview(slug: string) {
    const row = await this.getTemplateBySlug("whatsapp", slug)
    if (!row) return { ok: false, reason: "Template not found" }
    const brand = await this.ensureBrand()
    return {
      ok: true,
      template: this.withWhatsappAliases(row),
      components: renderJsonTemplate(row.components || [], { brand }),
    }
  }

  async pushWhatsappTemplateToPolygin(input: { slug: string }) {
    const row = await this.getTemplateBySlug("whatsapp", input.slug)
    if (!row) return { ok: false, reason: "Template not found" }
    const cfg = await this.getPolyginConfigDecrypted()
    if (!cfg?.dashboard_token) {
      return { ok: false, reason: "Polygin dashboard token is required to push templates." }
    }
    const polyginConfig: PolyginProvider.PolyginConfig = {
      token: cfg.token || "",
      dashboard_token: cfg.dashboard_token,
      sender_phone: cfg.sender_phone || "",
    }
    const result = await PolyginProvider.pushTemplate(polyginConfig, {
      name: row.name || row.slug,
      category: row.category || "UTILITY",
      language: row.language || "en_US",
      components: row.components || [],
    })
    const updated = await (this as any).updateCommunicationTemplates({
      id: row.id,
      provider_status: result.ok ? "pushed" : "failed",
      provider_template_id: result.provider_template_id || row.provider_template_id,
      provider_pushed_at: now(),
      provider_last_error: result.error || null,
    })
    return { ok: result.ok, row: this.withWhatsappAliases(updated), provider_response: result.raw || null }
  }

  async syncWhatsappTemplatesFromPolygin() {
    const cfg = await this.getPolyginConfigDecrypted()
    if (!cfg?.dashboard_token) {
      return { ok: false, reason: "Polygin dashboard token is required for template sync." }
    }
    const polyginConfig: PolyginProvider.PolyginConfig = {
      token: cfg.token || "",
      dashboard_token: cfg.dashboard_token,
      sender_phone: cfg.sender_phone || "",
    }
    const result = await PolyginProvider.syncTemplates(polyginConfig)
    if (!result.ok || !result.templates) {
      return { ok: false, reason: result.error || "Failed to sync templates" }
    }
    const updated = []
    for (const remote of result.templates) {
      const local = await this.getTemplateBySlug("whatsapp", remote.name)
      if (local) {
        const next = await (this as any).updateCommunicationTemplates({
          id: local.id,
          provider_status: remote.status,
          provider_template_id: remote.id,
          provider_last_synced_at: now(),
          provider_last_error: remote.rejection_reason || null,
        })
        updated.push(this.withWhatsappAliases(next))
      }
    }
    return { ok: true, updated }
  }

  async listWhatsappEventMappingsView() {
    const rows = await (this as any).listCommunicationEventRules({ channel: "whatsapp" })
    return rows.map((row: AnyRecord) => ({
      ...row,
      to_resolver: row.recipient_resolver,
      static_to: row.static_recipient,
    }))
  }

  async listEventRulesView(channel?: Channel) {
    const filters: AnyRecord = { tenant_key: DEFAULT_TENANT }
    if (channel) filters.channel = channel
    return (this as any).listCommunicationEventRules(filters, {
      order: { created_at: "DESC" },
      take: 500,
    })
  }

  async upsertWhatsappEventMapping(input: AnyRecord) {
    return this.upsertEventRule({
      event_name: input.event_name,
      channel: "whatsapp",
      template_slug: input.template_slug,
      recipient_resolver: input.to_resolver || "customer_phone",
      static_recipient: input.static_to || null,
      enabled: input.enabled ?? true,
    })
  }

  async sendOtp(input: {
    phone: string
    purpose?: "login" | "verify"
    customer_id?: string | null
    channel?: "sms" | "whatsapp"
  }) {
    const phone = normalizePhone(input.phone)
    const code = String(crypto.randomInt(100000, 999999))
    const ttlSeconds = Number(this.options_?.otp?.ttlSeconds || 300)
    const maxAttempts = Number(this.options_?.otp?.maxAttempts || 5)
    const row = await (this as any).createCommunicationOtpRequests({
      tenant_key: DEFAULT_TENANT,
      phone_e164: phone,
      purpose: input.purpose || "login",
      customer_id: input.customer_id || null,
      code_hash: hash(code),
      attempts: 0,
      max_attempts: maxAttempts,
      resend_count: 0,
      resend_available_at: new Date(Date.now() + Number(this.options_?.otp?.resendCooldownSeconds || 60) * 1000),
      expires_at: new Date(Date.now() + ttlSeconds * 1000),
      sent_via: null,
    })
    const sent = await this.sendPhoneMessage({
      to: phone,
      body: `{{brand}} OTP is ${code}. It expires in ${Math.ceil(ttlSeconds / 60)} minutes.`,
      channel: input.channel,
    })
    const updated = await (this as any).updateCommunicationOtpRequests({
      id: row.id,
      sent_via: sent.ok ? sent.channel : "failed",
    })
    return { ok: sent.ok, request_id: updated.id, expires_at: updated.expires_at, sent_via: updated.sent_via }
  }

  async verifyOtp(input: { phone: string; code: string; purpose?: "login" | "verify" }) {
    const phone = normalizePhone(input.phone)
    const rows = await (this as any).listCommunicationOtpRequests(
      { phone_e164: phone, purpose: input.purpose || "login", consumed_at: null },
      { order: { created_at: "DESC" }, take: 1 },
    )
    const row = rows[0]
    if (!row) return { ok: false, reason: "OTP not found" }
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "OTP expired" }
    if (row.attempts >= row.max_attempts) return { ok: false, reason: "Attempt limit exceeded" }
    const valid = row.code_hash === hash(input.code)
    const updated = await (this as any).updateCommunicationOtpRequests({
      id: row.id,
      attempts: row.attempts + 1,
      consumed_at: valid ? now() : null,
    })
    return valid ? { ok: true, request_id: updated.id } : { ok: false, reason: "Invalid OTP" }
  }

  async resendOtp(input: { phone: string; purpose?: "login" | "verify"; channel?: "sms" | "whatsapp" }) {
    return this.sendOtp(input)
  }

  async sendPhoneMessage(input: { to: string; body: string; channel?: "sms" | "whatsapp" }) {
    const brand = await this.ensureBrand()
    const body = renderTemplate(input.body, { brand })
    if (input.channel === "sms") {
      const result = await this.sendSms({ to: input.to, body })
      return { ...result, channel: result.ok ? "sms" : "failed" }
    }
    if (input.channel === "whatsapp") {
      const result = await this.sendWhatsapp({ to: input.to, text: body })
      return { ...result, channel: result.ok ? "whatsapp" : "failed" }
    }
    const wa = await this.sendWhatsapp({ to: input.to, text: body })
    if (wa.ok) return { ...wa, channel: "whatsapp" }
    const sms = await this.sendSms({ to: input.to, body })
    return { ...sms, channel: sms.ok ? "sms" : "failed" }
  }

  async processEvent(eventName: string, data: AnyRecord) {
    const rules = await (this as any).listCommunicationEventRules({
      event_name: eventName,
      enabled: true,
    })
    const results = []
    for (const rule of rules) {
      results.push(await this.executeRule(rule, data))
    }
    return { ok: true, results }
  }

  async recordWebhook(input: AnyRecord) {
    return (this as any).createCommunicationWebhookEvents({
      tenant_key: DEFAULT_TENANT,
      ...input,
      status: input.status || "received",
    })
  }

  async listSmsLogs(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listCommunicationMessageLogs({ ...filters, channel: "sms" }, config)
  }

  async listAndCountSmsLogs(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listAndCountCommunicationMessageLogs({ ...filters, channel: "sms" }, config)
  }

  async listWhatsappLogs(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listCommunicationMessageLogs({ ...filters, channel: "whatsapp" }, config)
  }

  async listAndCountWhatsappLogs(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listAndCountCommunicationMessageLogs({ ...filters, channel: "whatsapp" }, config)
  }

  async listOtpRequests(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listCommunicationOtpRequests(filters, config)
  }

  async listAndCountOtpRequests(filters: AnyRecord = {}, config: AnyRecord = {}) {
    return (this as any).listAndCountCommunicationOtpRequests(filters, config)
  }

  async replayWebhook(id: string) {
    const row = await (this as any).retrieveCommunicationWebhookEvent(id)
    return (this as any).updateCommunicationWebhookEvents({
      id,
      status: "replayed",
      processing_result: { replayed_at: now().toISOString(), original_status: row.status },
      processed_at: now(),
    })
  }

  protected async ensureBrand() {
    const rows = await (this as any).listCommunicationBrandConfigs(
      { tenant_key: DEFAULT_TENANT },
      { take: 1 },
    )
    if (rows[0]) return rows[0]
    return (this as any).createCommunicationBrandConfigs({
      tenant_key: DEFAULT_TENANT,
      brand_name: this.options_?.brand?.brand_name || "Communication Hub",
      company_name: this.options_?.brand?.company_name || null,
      storefront_url: this.options_?.brand?.storefront_url || "https://example.com",
      tagline: this.options_?.brand?.tagline || null,
      support_email: this.options_?.brand?.support_email || null,
      support_phone: this.options_?.brand?.support_phone || null,
      address: this.options_?.brand?.address || null,
      whatsapp_bot_label: "Initiate Bot",
      whatsapp_bot_categories: ["UTILITY", "MARKETING"],
    })
  }

  protected async getProviderConfig(channel: Channel, provider: string) {
    const rows = await (this as any).listCommunicationProviderConfigs(
      { tenant_key: DEFAULT_TENANT, channel, provider },
      { take: 1 },
    )
    return rows[0] || null
  }

  protected providerView(cfg: AnyRecord | null, secretKeys: string[]) {
    const settings = cfg?.settings || {}
    const secrets = cfg?.secrets || {}
    const secretView = Object.fromEntries(
      secretKeys.map((key) => [`${key}_set`, Boolean(secrets[key])]),
    )
    return {
      id: cfg?.id || null,
      provider: cfg?.provider || null,
      enabled: Boolean(cfg?.enabled),
      configured: Boolean(cfg),
      ...settings,
      ...secretView,
      masked: Object.fromEntries(secretKeys.map((key) => [key, maskSecret(secrets[key])])),
      last_test_ok: cfg?.last_test_ok ?? null,
      last_test_error: cfg?.last_test_error ?? null,
      last_test_at: cfg?.last_test_at ?? null,
    }
  }

  protected providerDecrypted(cfg: AnyRecord | null) {
    if (!cfg) return null
    const secrets: AnyRecord = {}
    for (const [key, value] of Object.entries(cfg.secrets || {})) {
      secrets[key] = decryptSecret(value as string, this.encryptionSecret_)
    }
    return { ...cfg.settings, ...secrets, enabled: cfg.enabled, provider: cfg.provider }
  }

  protected async upsertProviderConfig(channel: Channel, provider: string, input: AnyRecord, secretKeys: string[]) {
    const existing = await this.getProviderConfig(channel, provider)
    const settings = { ...(existing?.settings || {}) }
    const secrets = { ...(existing?.secrets || {}) }
    for (const [key, value] of Object.entries(input)) {
      if (secretKeys.includes(key)) {
        if (value === null) delete secrets[key]
        else if (typeof value === "string" && value.length > 0) {
          secrets[key] = encryptSecret(value, this.encryptionSecret_)
        }
      } else if (key !== "enabled") {
        settings[key] = value
      }
    }
    const payload = {
      tenant_key: DEFAULT_TENANT,
      channel,
      provider,
      enabled: input.enabled ?? existing?.enabled ?? false,
      settings,
      secrets,
    }
    const row = existing
      ? await (this as any).updateCommunicationProviderConfigs({ id: existing.id, ...payload })
      : await (this as any).createCommunicationProviderConfigs(payload)
    await this.audit("provider.updated", "provider_config", row.id, existing, this.providerView(row, secretKeys))
    return this.providerView(row, secretKeys)
  }

  protected async recordProviderTest(channel: Channel, provider: string, ok: boolean, error: string | null) {
    const cfg = await this.getProviderConfig(channel, provider)
    if (!cfg) return null
    return (this as any).updateCommunicationProviderConfigs({
      id: cfg.id,
      last_test_ok: ok,
      last_test_error: error,
      last_test_at: now(),
    })
  }

  protected async listTemplatesView(channel: Channel, filters: AnyRecord = {}) {
    const normalized = { ...filters, channel, tenant_key: DEFAULT_TENANT }
    if (normalized.polygin_status) {
      normalized.provider_status = normalized.polygin_status
      delete normalized.polygin_status
    }
    return (this as any).listCommunicationTemplates(normalized, {
      order: { created_at: "DESC" },
      take: 500,
    })
  }

  protected async getTemplateBySlug(channel: Channel, slug: string) {
    const rows = await (this as any).listCommunicationTemplates(
      { channel, slug, tenant_key: DEFAULT_TENANT },
      { take: 1 },
    )
    return rows[0] || null
  }

  protected async upsertTemplate(channel: Channel, input: AnyRecord) {
    const existing = await this.getTemplateBySlug(channel, input.slug)
    const payload = {
      tenant_key: DEFAULT_TENANT,
      channel,
      slug: input.slug,
      name: input.name || input.slug.replace(/[.-]/g, "_"),
      label: input.label || null,
      description: input.description || null,
      category: input.category || null,
      language: input.language || "en_US",
      template_type: input.template_type || "STANDARD",
      subject: input.subject || null,
      body: input.body || null,
      html: input.html || null,
      mjml: input.mjml || null,
      components: input.components || null,
      variables: input.variables || null,
      media: input.media || null,
      is_system: input.is_system ?? existing?.is_system ?? false,
      is_otp: input.is_otp ?? existing?.is_otp ?? false,
      dlt_template_id: input.dlt_template_id ?? existing?.dlt_template_id ?? null,
      dlt_status: input.dlt_status ?? existing?.dlt_status ?? "draft",
      provider_template_id: input.provider_template_id ?? existing?.provider_template_id ?? null,
      provider_status: input.provider_status ?? existing?.provider_status ?? "draft",
      provider_last_error: input.provider_last_error ?? existing?.provider_last_error ?? null,
    }
    const row = existing
      ? await (this as any).updateCommunicationTemplates({ id: existing.id, ...payload })
      : await (this as any).createCommunicationTemplates(payload)
    await this.audit("template.updated", "template", row.id, existing, row)
    return row
  }

  protected async refreshTemplates(channel: Channel, templates: AnyRecord[]) {
    let inserted = 0
    let updated = 0
    const skipped: string[] = []
    for (const template of templates) {
      const existing = await this.getTemplateBySlug(channel, template.slug)
      if (existing && !existing.is_system) {
        skipped.push(template.slug)
        continue
      }
      await this.upsertTemplate(channel, { ...template, is_system: true, provider_status: "draft" })
      existing ? updated++ : inserted++
    }
    return { ok: true, inserted, updated, skipped }
  }

  protected withWhatsappAliases(row: AnyRecord) {
    return {
      ...row,
      polygin_status: row.provider_status || "draft",
      polygin_template_id: row.provider_template_id || null,
      polygin_pushed_at: row.provider_pushed_at || null,
      polygin_last_synced_at: row.provider_last_synced_at || null,
      polygin_last_error: row.provider_last_error || null,
    }
  }

  protected async createMessageLog(input: AnyRecord) {
    return (this as any).createCommunicationMessageLogs({
      tenant_key: DEFAULT_TENANT,
      ...input,
    })
  }

  protected async renderWhatsappBody(slug: string, variables: AnyRecord) {
    const row = await this.getTemplateBySlug("whatsapp", slug)
    const brand = await this.ensureBrand()
    const bodyComponent = asArray(row?.components).find((component: AnyRecord) => component?.type === "BODY")
    return renderTemplate(bodyComponent?.text || row?.body || "", { ...variables, brand }, { keepUnknown: true })
  }

  protected async upsertEventRule(input: AnyRecord) {
    const rows = await (this as any).listCommunicationEventRules(
      {
        tenant_key: DEFAULT_TENANT,
        event_name: input.event_name,
        channel: input.channel,
        template_slug: input.template_slug,
      },
      { take: 1 },
    )
    const existing = rows[0]
    const payload = {
      tenant_key: DEFAULT_TENANT,
      event_name: input.event_name,
      channel: input.channel,
      template_slug: input.template_slug,
      recipient_resolver: input.recipient_resolver || "customer",
      static_recipient: input.static_recipient || null,
      enabled: input.enabled ?? true,
      delay_seconds: input.delay_seconds || 0,
      conditions: input.conditions || null,
      retry_policy: input.retry_policy || null,
    }
    return existing
      ? (this as any).updateCommunicationEventRules({ id: existing.id, ...payload })
      : (this as any).createCommunicationEventRules(payload)
  }

  protected async executeRule(rule: AnyRecord, data: AnyRecord) {
    const brand = await this.ensureBrand()
    const context = { ...data, brand }
    const recipient =
      rule.static_recipient ||
      data?.customer?.email ||
      data?.customer?.phone ||
      data?.shipping_address?.phone ||
      data?.email ||
      data?.phone
    if (!recipient) return { ok: false, reason: "No recipient", rule_id: rule.id }
    const template = await this.getTemplateBySlug(rule.channel, rule.template_slug)
    if (!template) return { ok: false, reason: "Template not found", rule_id: rule.id }
    if (rule.channel === "email") {
      return this.sendEmail({
        to: recipient,
        subject: renderTemplate(template.subject || template.label || "", context),
        html: renderTemplate(template.html || template.body || "", context),
        metadata: { event_name: rule.event_name, rule_id: rule.id },
      })
    }
    if (rule.channel === "sms") {
      return this.sendSms({
        to: recipient,
        body: renderTemplate(template.body || "", context),
        metadata: { event_name: rule.event_name, rule_id: rule.id },
      })
    }
    return this.sendWhatsapp({
      to: recipient,
      template_slug: template.slug,
      variables: context,
      metadata: { event_name: rule.event_name, rule_id: rule.id },
    })
  }

  protected async audit(action: string, resourceType: string, resourceId: string | null, oldValue: AnyRecord | null, newValue: AnyRecord | null) {
    return (this as any).createCommunicationAuditLogs({
      tenant_key: DEFAULT_TENANT,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      old_value: oldValue || null,
      new_value: newValue || null,
    })
  }
}

export default CommunicationModuleService
