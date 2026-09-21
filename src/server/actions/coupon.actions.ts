"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { validateCouponForOrder } from "@/server/services/coupon.service"
import { findVariantsForPricing } from "@/server/repositories/variant.repository"

/** Rate limiting en memoria por IP (se reinicia al reiniciar el proceso). */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 15

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const record = attempts.get(ip)
  if (record && now < record.resetAt) {
    if (record.count >= MAX_ATTEMPTS) return true
    record.count++
    return false
  }
  attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  return false
}

const inputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  items: z
    .array(
      z.object({
        variantId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
})

export interface CouponValidationResult {
  valid: boolean
  code?: string
  discountAmount?: number
  error?: string
}

/**
 * Valida un cupón para el checkout. Pública (el cliente aún no tiene pedido),
 * solo lectura; el descuento definitivo se recalcula en `placeOrder`.
 *
 * SEGURIDAD: recibe solo `variantId`+`quantity` del carrito del cliente —
 * precio y categoría siempre se resuelven aquí desde la base de datos, nunca
 * se confía en un monto o categoría que mande el navegador.
 */
export async function validateCouponAction(
  code: string,
  items: { variantId: string; quantity: number }[]
): Promise<CouponValidationResult> {
  const parsed = inputSchema.safeParse({ code, items })
  if (!parsed.success) {
    return { valid: false, error: "Cupón no válido" }
  }

  const headerList = await headers()
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return { valid: false, error: "Demasiados intentos. Espera un minuto." }
  }

  try {
    const variantIds = parsed.data.items.map((i) => i.variantId)
    const variants = await findVariantsForPricing(variantIds)
    const variantMap = new Map(variants.map((v) => [v.id, v]))

    // Igual que placeOrder: un producto que ya no está disponible no se ignora
    // en silencio (daría un descuento incorrecto), se le avisa al cliente.
    if (parsed.data.items.some((i) => !variantMap.has(i.variantId))) {
      return {
        valid: false,
        error: "Algún producto de tu carrito ya no está disponible. Revisa tu carrito.",
      }
    }

    const resolvedItems = parsed.data.items.map(({ variantId, quantity }) => {
      const variant = variantMap.get(variantId)!
      const unitPrice =
        variant.product.isOnSale && variant.product.salePrice !== null
          ? variant.product.salePrice.toNumber()
          : variant.product.basePrice.toNumber()
      return { categoryId: variant.product.categoryId, unitPrice, quantity }
    })

    const result = await validateCouponForOrder(parsed.data.code, resolvedItems)
    if (!result.valid) {
      return { valid: false, error: result.reason }
    }
    return { valid: true, code: result.code, discountAmount: result.discountAmount }
  } catch (error) {
    console.error("[validateCouponAction]", error)
    return { valid: false, error: "No se pudo validar el cupón. Intenta de nuevo." }
  }
}
