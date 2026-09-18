import "server-only"
import { prisma } from "../db/prisma"
import { GIFT_CARD_SKU_PREFIX } from "@/lib/gift-card"

/**
 * Variantes de tarjeta de regalo comprables. Se exigen las mismas condiciones
 * que `findVariantsForPricing` (publicado y disponible online): si la variante
 * no las cumple, el checkout la rechazaría después de añadirla al carrito.
 */
export async function findPurchasableGiftCardVariants() {
  return prisma.variant.findMany({
    where: {
      sku: { startsWith: GIFT_CARD_SKU_PREFIX },
      product: { isPublished: true, availableOnline: true },
    },
    select: {
      id: true,
      sku: true,
      stock: true,
      productId: true,
      product: { select: { basePrice: true } },
    },
  })
}

export async function createGiftCardRecord(data: {
  code: string
  balance: number
  orderId: string
  customerEmail: string | null
}) {
  return prisma.giftCard.create({ data })
}

export async function findGiftCardByCode(code: string) {
  return prisma.giftCard.findUnique({ where: { code } })
}

/**
 * Descuenta `amount` del saldo de una tarjeta de forma atómica: la condición
 * `balance >= amount` viaja en el propio UPDATE para que dos canjes
 * simultáneos no dejen el saldo negativo (mismo patrón que el descuento de
 * stock en `markOrderPaidWithStock`).
 */
export async function redeemGiftCardAmountRecord(code: string, amount: number) {
  const result = await prisma.giftCard.updateMany({
    where: { code, isActive: true, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  })
  if (result.count === 0) return null

  const updated = await prisma.giftCard.findUnique({ where: { code } })
  if (updated && updated.balance.toNumber() === 0) {
    await prisma.giftCard.update({ where: { code }, data: { isActive: false } })
  }
  return updated
}
