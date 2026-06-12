import { Module } from "@medusajs/framework/utils"
import CustomerIdentityService from "./service"

export const CUSTOMER_IDENTITY_MODULE = "customer_identity"

export default Module(CUSTOMER_IDENTITY_MODULE, {
  service: CustomerIdentityService,
})

export { CustomerIdentityService }
export { formatClientId, istIsoWeek, isClientIdShape } from "./iso-week"
