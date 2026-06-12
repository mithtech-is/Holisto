import assert from "node:assert/strict"
import test from "node:test"

test("renders nested and brand alias variables while preserving positional slots", async () => {
  const { renderTemplate } = await import("../src/modules/communication/utils/render.ts")
  const output = renderTemplate(
    "Hi {{ customer.first_name }}, order {{order.display_id}} from {{brand}} uses {{1}}.",
    { customer: { first_name: "Ada" }, order: { display_id: "1001" }, brand: { brand_name: "Communication Hub" } },
    { keepUnknown: true },
  )
  assert.equal(output, "Hi Ada, order 1001 from Communication Hub uses {{1}}.")
})

test("renders variables inside component JSON", async () => {
  const { renderJsonTemplate } = await import("../src/modules/communication/utils/render.ts")
  const rendered = renderJsonTemplate(
    [{ type: "BODY", text: "Pay {{order.total}} at {{storefront_url}}" }],
    { order: { total: "99.00" }, brand: { storefront_url: "https://example.com" } },
  )
  assert.deepEqual(rendered, [{ type: "BODY", text: "Pay 99.00 at https://example.com" }])
})

test("extracts named variables and ignores positional template slots", async () => {
  const { extractVariables } = await import("../src/modules/communication/utils/render.ts")
  assert.deepEqual(extractVariables("{{1}} {{brand}} {{ customer.email }} {{brand}}"), [
    "brand",
    "customer.email",
  ])
})

test("returns empty string for unknown variables when keepUnknown is false", async () => {
  const { renderTemplate } = await import("../src/modules/communication/utils/render.ts")
  const output = renderTemplate("Hello {{unknown_var}}!", {})
  assert.equal(output, "Hello !")
})

test("keeps unknown variables when keepUnknown is true", async () => {
  const { renderTemplate } = await import("../src/modules/communication/utils/render.ts")
  const output = renderTemplate("Hello {{unknown_var}}!", {}, { keepUnknown: true })
  assert.equal(output, "Hello {{unknown_var}}!")
})

test("handles null template gracefully", async () => {
  const { renderTemplate } = await import("../src/modules/communication/utils/render.ts")
  assert.equal(renderTemplate(null, {}), "")
  assert.equal(renderTemplate(undefined, {}), "")
})

test("uses brand aliases correctly", async () => {
  const { renderTemplate } = await import("../src/modules/communication/utils/render.ts")
  const output = renderTemplate(
    "{{company_name}} - {{support_email}} - {{support_phone}}",
    {
      brand: {
        company_name: "Acme Corp",
        support_email: "help@acme.com",
        support_phone: "+1-555-0000",
      },
    },
  )
  assert.equal(output, "Acme Corp - help@acme.com - +1-555-0000")
})

test("renderJsonTemplate handles primitive values", async () => {
  const { renderJsonTemplate } = await import("../src/modules/communication/utils/render.ts")
  assert.equal(renderJsonTemplate(42, {}), 42)
  assert.equal(renderJsonTemplate(true, {}), true)
  assert.equal(renderJsonTemplate(null, {}), null)
})

test("extractVariables returns empty for templates with no variables", async () => {
  const { extractVariables } = await import("../src/modules/communication/utils/render.ts")
  assert.deepEqual(extractVariables("Static text without variables"), [])
  assert.deepEqual(extractVariables(""), [])
  assert.deepEqual(extractVariables(null), [])
})
