import assert from "node:assert/strict"
import test from "node:test"

test("seed templates have all required fields", async () => {
  const { DEFAULT_SMS_TEMPLATES, DEFAULT_WHATSAPP_TEMPLATES, DEFAULT_EMAIL_TEMPLATES, DEFAULT_EVENT_RULES } = await import("../src/modules/communication/seed/templates.ts")

  assert.ok(DEFAULT_SMS_TEMPLATES.length > 0, "SMS templates should not be empty")
  assert.ok(DEFAULT_WHATSAPP_TEMPLATES.length > 0, "WhatsApp templates should not be empty")
  assert.ok(DEFAULT_EMAIL_TEMPLATES.length > 0, "Email templates should not be empty")
  assert.ok(DEFAULT_EVENT_RULES.length > 0, "Event rules should not be empty")

  for (const tpl of DEFAULT_SMS_TEMPLATES) {
    assert.ok(tpl.slug, `SMS template must have a slug`)
    assert.ok(tpl.body, `SMS template ${tpl.slug} must have a body`)
  }

  for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
    assert.ok(tpl.slug, `WhatsApp template must have a slug`)
    assert.ok(tpl.components, `WhatsApp template ${tpl.slug} must have components`)
    assert.ok(tpl.category, `WhatsApp template ${tpl.slug} must have a category`)
    assert.ok(["AUTHENTICATION", "UTILITY", "MARKETING"].includes(tpl.category),
      `WhatsApp template ${tpl.slug} category must be AUTHENTICATION, UTILITY, or MARKETING`)
  }

  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    assert.ok(tpl.slug, `Email template must have a slug`)
    assert.ok(tpl.subject, `Email template ${tpl.slug} must have a subject`)
    assert.ok(tpl.html, `Email template ${tpl.slug} must have html body`)
  }

  for (const rule of DEFAULT_EVENT_RULES) {
    assert.ok(rule.event_name, `Event rule must have an event_name`)
    assert.ok(rule.channel, `Event rule must have a channel`)
    assert.ok(["email", "sms", "whatsapp"].includes(rule.channel), `Channel must be valid`)
    assert.ok(rule.template_slug, `Event rule must have a template_slug`)
  }
})

test("all email templates have corresponding event rules", async () => {
  const { DEFAULT_EMAIL_TEMPLATES, DEFAULT_EVENT_RULES } = await import("../src/modules/communication/seed/templates.ts")
  const emailEventSlugs = new Set(
    DEFAULT_EVENT_RULES.filter((r) => r.channel === "email").map((r) => r.template_slug),
  )
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    assert.ok(emailEventSlugs.has(tpl.slug), `Email template ${tpl.slug} should have a corresponding event rule`)
  }
})

test("all WhatsApp templates have correct component structure", async () => {
  const { DEFAULT_WHATSAPP_TEMPLATES } = await import("../src/modules/communication/seed/templates.ts")
  for (const tpl of DEFAULT_WHATSAPP_TEMPLATES) {
    const bodyComponent = tpl.components.find((c) => c.type === "BODY")
    assert.ok(bodyComponent, `WhatsApp template ${tpl.slug} must have a BODY component`)
    assert.ok(bodyComponent.text, `WhatsApp template ${tpl.slug} BODY must have text`)
  }
})
