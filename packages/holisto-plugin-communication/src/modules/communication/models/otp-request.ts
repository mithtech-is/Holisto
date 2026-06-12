// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationOtpRequest = model.define("communication_otp_request", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  phone_e164: model.text(),
  purpose: model.enum(["login", "verify"]),
  customer_id: model.text().nullable(),
  code_hash: model.text(),
  attempts: model.number().default(0),
  max_attempts: model.number().default(5),
  resend_count: model.number().default(0),
  resend_available_at: model.dateTime().nullable(),
  expires_at: model.dateTime(),
  consumed_at: model.dateTime().nullable(),
  sent_via: model.text().nullable(),
  ip_hash: model.text().nullable(),
})
