// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationAuditLog = model.define("communication_audit_log", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  actor_user_id: model.text().nullable(),
  action: model.text(),
  resource_type: model.text(),
  resource_id: model.text().nullable(),
  old_value: model.json().nullable(),
  new_value: model.json().nullable(),
  metadata: model.json().nullable(),
})
