import "server-only"

import { isGiftCardSku, isValidGiftCardAmount, type GiftCardOption } from "@/lib/gift-card"
import { generateGiftCardCode } from "@/lib/gift-card-code"
import {
  findPurchasableGiftCardVariants,
  createGiftCardRecord,
  findGiftCardByCode,
  redeemGiftCardAmountRecord,
} from "../repositories/gift-card.repository"
import { sendGiftCardEmail } from "./email.service"
import type { OrderDTO } from "./order.service"

/**
 * Montos de tarjeta de regalo que se pueden comprar ahora mismo, ordenados de
 * menor a mayor. Descarta las variantes sin stock o con un precio fuera del
 * rango permitido para no ofrecer una opción que el checkout va a rechazar.
 */
export async function getGiftCardOptions(): Promise<GiftCardOption[]> {
  const variants = await findPurchasableGiftCardVariants()

  return variants
    .flatMap((variant) => {
      const amount = variant.product.basePrice.toNumber()
      if (variant.stock <= 0 || !isValidGiftCardAmount(amount)) return []
      return [
        {
          variantId: variant.id,
          productId: variant.productId,
          sku: variant.sku,
          amount,
        },
      ]
    })
    .sort((a, b) => a.amount - b.amount)
}

const MAX_CODE_ATTEMPTS = 5

async function createUniqueGiftCard(params: {
  balance: number
  orderId: string
  customerEmail: string | null
}) {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    try {
      return await createGiftCardRecord({ code: generateGiftCardCode(), ...params })
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo generar un código de tarjeta de regalo único.")
}

export interface IssuedGiftCard {
  code: string
  balance: number
}

/**
 * Emite una tarjeta de regalo por cada UNIDAD comprada (no una por línea de
 * pedido): dos tarjetas de $100.000 en el mismo pedido son dos códigos
 * distintos, porque cada una es un regalo para una persona distinta.
 */
export async function issueGiftCardsForOrder(order: OrderDTO): Promise<IssuedGiftCard[]> {
  const giftItems = (order.items ?? []).filter((i) => i.sku && isGiftCardSku(i.sku))
  if (giftItems.length === 0) return []

  const issued: IssuedGiftCard[] = []
  for (const item of giftItems) {
    for (let unit = 0; unit < item.quantity; unit++) {
      const card = await createUniqueGiftCard({
        balance: item.unitPrice,
        orderId: order.id,
        customerEmail: order.customerEmail,
      })
      issued.push({ code: card.code, balance: card.balance.toNumber() })
    }
  }
  return issued
}

/**
 * Efecto posterior al pago aprobado, mismo patrón fire-and-forget que
 * `runPostPaymentEffects` en payment.service: nunca debe hacer fallar ni
 * revertir el pago si la emisión o el correo fallan.
 */
export async function issueAndSendGiftCardsForOrder(order: OrderDTO): Promise<void> {
  const issued = await issueGiftCardsForOrder(order)
  if (issued.length === 0 || !order.customerEmail) return
  await sendGiftCardEmail({
    email: order.customerEmail,
    name: order.customerName ?? undefined,
    orderId: order.id,
    cards: issued,
  })
}

export interface GiftCardLookupResult {
  code: string
  balance: number
  isActive: boolean
  orderId: string | null
  createdAt: string
}

function toLookupResult(card: {
  code: string
  balance: { toNumber: () => number }
  isActive: boolean
  orderId: string | null
  createdAt: Date
}): GiftCardLookupResult {
  return {
    code: card.code,
    balance: card.balance.toNumber(),
    isActive: card.isActive,
    orderId: card.orderId,
    createdAt: card.createdAt.toISOString(),
  }
}

export async function searchGiftCard(code: string): Promise<GiftCardLookupResult | null> {
  const card = await findGiftCardByCode(code.trim().toUpperCase())
  return card ? toLookupResult(card) : null
}

export async function redeemGiftCard(code: string, amount: number): Promise<GiftCardLookupResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El monto a canjear debe ser mayor a cero.")
  }
  const normalized = code.trim().toUpperCase()
  const existing = await findGiftCardByCode(normalized)
  if (!existing) throw new Error("Código no encontrado.")
  if (!existing.isActive || existing.balance.toNumber() <= 0) {
    throw new Error("Esta tarjeta ya no tiene saldo disponible.")
  }
  if (amount > existing.balance.toNumber()) {
    throw new Error("El monto excede el saldo disponible.")
  }

  const updated = await redeemGiftCardAmountRecord(normalized, amount)
  if (!updated) throw new Error("El monto excede el saldo disponible.")
  return toLookupResult(updated)
}
