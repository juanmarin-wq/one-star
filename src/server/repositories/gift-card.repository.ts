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

const MAX_CODE_ATTEMPTS = 5

/**
 * Emite las tarjetas que le falten a un pedido. Idempotente y a prueba de
 * concurrencia: un lock de asesor por pedido serializa las llamadas y solo se
 * crean las tarjetas que aún no existen (por conteo), de modo que el webhook
 * y la confirmación manual no pueden duplicar tarjetas canjeables.
 * `balances` lista el saldo de cada tarjeta esperada, una por unidad.
 */
export async function issueMissingGiftCardsForOrder(
  params: { orderId: string; customerEmail: string | null; balances: number[] },
  generateCode: () => string
): Promise<{ code: string; balance: number }[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.orderId}))`
    const existing = await tx.giftCard.count({ where: { orderId: params.orderId } })
    const issued: { code: string; balance: number }[] = []
    for (const balance of params.balances.slice(existing)) {
      let code = generateCode()
      for (let attempt = 1; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        if (!(await tx.giftCard.findUnique({ where: { code }, select: { id: true } }))) break
        code = generateCode()
      }
      await tx.giftCard.create({
        data: { code, balance, orderId: params.orderId, customerEmail: params.customerEmail },
      })
      issued.push({ code, balance })
    }
    return issued
  })
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
