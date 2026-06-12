import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../modules/communication"

export default async function communicationEventsSubscriber({ event, container }: SubscriberArgs<Record<string, unknown>>) {
  const mod = container.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  await mod.processEvent(event.name, event.data || {})
}

export const config: SubscriberConfig = {
  event: [
    "customer.created",
    "customer.updated",
    "customer.approved",
    "customer.rejected",
    "order.created",
    "order.placed",
    "order.paid",
    "order.completed",
    "order.cancelled",
    "order.fulfilled",
    "shipment.delivered",
    "kyc.approved",
    "kyc.rejected",
    "password.reset",
    "otp.sent",
    "otp.verified",
    "customer.login",
    "wallet.credited",
    "wallet.debited",
  ],
}
