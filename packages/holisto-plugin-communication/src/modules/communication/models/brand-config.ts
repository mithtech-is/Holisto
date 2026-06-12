// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationBrandConfig = model.define("communication_brand_config", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  brand_name: model.text().default("Communication Hub"),
  company_name: model.text().nullable(),
  storefront_url: model.text().default("https://example.com"),
  tagline: model.text().nullable(),
  support_email: model.text().nullable(),
  support_phone: model.text().nullable(),
  address: model.text().nullable(),
  whatsapp_bot_label: model.text().default("Initiate Bot"),
  whatsapp_bot_categories: model.json().nullable(),
  updated_by_user_id: model.text().nullable(),
})
