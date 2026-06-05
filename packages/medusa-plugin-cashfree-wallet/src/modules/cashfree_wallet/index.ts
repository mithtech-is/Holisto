import { Module } from "@medusajs/framework/utils"
import CashfreeWalletService from "./service"

export const CASHFREE_WALLET_MODULE = "cashfree_wallet"

export default Module(CASHFREE_WALLET_MODULE, {
  service: CashfreeWalletService,
})

export { CashfreeWalletService }
