// @ts-nocheck
import { Module } from "@medusajs/framework/utils"
import CommunicationModuleService from "./service"

export const COMMUNICATION_MODULE = "communication"

export default Module(COMMUNICATION_MODULE, {
  service: CommunicationModuleService,
})

export { CommunicationModuleService }
