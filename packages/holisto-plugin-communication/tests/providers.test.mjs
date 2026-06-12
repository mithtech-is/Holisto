import assert from "node:assert/strict"
import test from "node:test"

test("Msg91Provider - sendSms function exists and returns an object", async () => {
  const Msg91Provider = await import("../src/modules/communication/providers/msg91.provider.ts")
  assert.equal(typeof Msg91Provider.sendSms, "function", "sendSms should be a function")
  const result = await Msg91Provider.sendSms(
    { auth_key: "invalid-key", sender_id: "TEST" },
    { to: "+1234567890", body: "Test message" },
  )
  assert.ok("ok" in result, "Result should have ok field")
})

test("Msg91Provider - testMsg91Connection function exists", async () => {
  const Msg91Provider = await import("../src/modules/communication/providers/msg91.provider.ts")
  assert.equal(typeof Msg91Provider.testMsg91Connection, "function", "testMsg91Connection should be a function")
})

test("Msg91Provider - sendOtpSms function exists and returns an object", async () => {
  const Msg91Provider = await import("../src/modules/communication/providers/msg91.provider.ts")
  assert.equal(typeof Msg91Provider.sendOtpSms, "function", "sendOtpSms should be a function")
  const result = await Msg91Provider.sendOtpSms(
    { auth_key: "invalid", sender_id: "TEST" },
    "+1234567890",
    "123456",
  )
  assert.ok("ok" in result, "Result should have ok field")
})

test("PolyginProvider - sendWhatsappMessage returns error with invalid token", async () => {
  const PolyginProvider = await import("../src/modules/communication/providers/polygin.provider.ts")
  const result = await PolyginProvider.sendWhatsappMessage(
    { token: "invalid", sender_phone: "+1234567890" },
    { to: "+1234567890", text: "Hello" },
  )
  assert.equal(result.ok, false)
  assert.ok(result.error)
})

test("PolyginProvider - sendWhatsappTemplate returns error with invalid token", async () => {
  const PolyginProvider = await import("../src/modules/communication/providers/polygin.provider.ts")
  const result = await PolyginProvider.sendWhatsappTemplate(
    { token: "invalid", sender_phone: "+1234567890" },
    { to: "+1234567890", template_name: "test_template" },
  )
  assert.equal(result.ok, false)
  assert.ok(result.error)
})

test("PolyginProvider - pushTemplate returns error without dashboard token", async () => {
  const PolyginProvider = await import("../src/modules/communication/providers/polygin.provider.ts")
  const result = await PolyginProvider.pushTemplate(
    { token: "api-token", sender_phone: "+1234567890" },
    { name: "test", category: "UTILITY", language: "en_US", components: [] },
  )
  assert.equal(result.ok, false)
  assert.equal(result.error, "Dashboard token required for template push")
})

test("PolyginProvider - syncTemplates returns error without dashboard token", async () => {
  const PolyginProvider = await import("../src/modules/communication/providers/polygin.provider.ts")
  const result = await PolyginProvider.syncTemplates(
    { token: "api-token", sender_phone: "+1234567890" },
  )
  assert.equal(result.ok, false)
  assert.equal(result.error, "Dashboard token required for template sync")
})

test("PolyginProvider - testPolyginConnection returns error with invalid token", async () => {
  const PolyginProvider = await import("../src/modules/communication/providers/polygin.provider.ts")
  const result = await PolyginProvider.testPolyginConnection(
    { token: "invalid", sender_phone: "+1234567890" },
  )
  assert.equal(result.ok, false)
  assert.ok(result.error)
})
