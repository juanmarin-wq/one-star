"use server"

import { requireAdmin } from "@/server/auth/require-admin"
import {
  searchGiftCard,
  redeemGiftCard,
  type GiftCardLookupResult,
} from "@/server/services/gift-card.service"

export interface GiftCardActionResult {
  success: boolean
  data?: GiftCardLookupResult
  error?: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error inesperado."
}

export async function searchGiftCardAction(code: string): Promise<GiftCardActionResult> {
  try {
    await requireAdmin()
    const result = await searchGiftCard(code)
    if (!result) return { success: false, error: "Código no encontrado." }
    return { success: true, data: result }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function redeemGiftCardAction(code: string, amount: number): Promise<GiftCardActionResult> {
  try {
    await requireAdmin()
    const result = await redeemGiftCard(code, amount)
    return { success: true, data: result }
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) }
  }
}
