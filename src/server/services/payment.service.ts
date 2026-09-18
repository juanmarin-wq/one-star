import "server-only"
import { EpaycoStatus, fetchEpaycoTransaction } from "./epayco.service"
import {
  changeOrderStatus,
  closeOrderWithoutPayment,
  getOrderById,
  sendOrderConfirmation,
  type OrderDTO,
} from "./order.service"
import { updateOrderPaymentReference } from "../repositories/order.repository"
import { sendMetaPurchaseForOrder } from "./meta-conversions.service"
import { issueAndSendGiftCardsForOrder } from "./gift-card.service"

/** Tolerancia para comparar montos (centavos por redondeo de la pasarela) */
const AMOUNT_TOLERANCE = 0.01

/** Notificación de la pasarela ya normalizada (webhook o consulta por referencia). */
export interface PaymentNotification {
  orderId: string
  refPayco: string
  amount: string
  /** Código de ePayco: 1 aceptada, 2 rechazada, 3 pendiente, 4 fallida */
  codResponse: string
}

export type PaymentOutcome =
  | "paid"
  | "already_paid"
  | "amount_mismatch"
  | "rejected"
  | "already_cancelled"
  | "ignored_rejection"
  | "late_approval"
  | "pending"
  | "order_not_found"

export interface PaymentResult {
  outcome: PaymentOutcome
  order: OrderDTO | null
}

/**
 * Efectos posteriores a un pago aprobado. Fire-and-forget: ni el correo ni el
 * evento de marketing deben hacer fallar la confirmación del pago.
 */
function runPostPaymentEffects(order: OrderDTO): void {
  sendOrderConfirmation(order).catch((error: unknown) => {
    console.error(`[payment] Correo de confirmación del pedido ${order.id} falló:`, error)
  })
  sendMetaPurchaseForOrder(order).catch((error: unknown) => {
    console.error(`[payment] Meta CAPI falló para pedido ${order.id}:`, error)
  })
  issueAndSendGiftCardsForOrder(order).catch((error: unknown) => {
    console.error(`[payment] Emisión de tarjeta(s) de regalo falló para pedido ${order.id}:`, error)
  })
}

/**
 * Aplica sobre el pedido el resultado que reporta la pasarela. Idempotente:
 * un pago aprobado nunca se degrada por un rechazo tardío y un pedido ya
 * pagado no vuelve a descontar stock ni a enviar correo.
 */
export async function applyPaymentNotification(
  notification: PaymentNotification
): Promise<PaymentResult> {
  const order = await getOrderById(notification.orderId)
  if (!order) return { outcome: "order_not_found", order: null }

  // Referencia de la pasarela para conciliación (y para saber que la
  // pasarela sí llegó a procesar este pedido).
  if (notification.refPayco && order.paymentReference !== notification.refPayco) {
    await updateOrderPaymentReference(order.id, notification.refPayco)
  }

  switch (notification.codResponse) {
    case EpaycoStatus.ACCEPTED: {
      if (order.paymentStatus === "APPROVED" || order.status === "PAID") {
        return { outcome: "already_paid", order }
      }
      if (order.status === "CANCELLED") {
        // El pedido ya se cerró (rechazo previo, vencimiento o cancelación
        // manual) y su cupón se liberó: no se resucita solo. Queda la
        // referencia guardada para que el admin lo revise y, si el cobro es
        // real, lo marque como pagado a mano.
        console.error(
          `[payment] Pago aprobado (ref=${notification.refPayco}) para pedido ${order.id} ya CANCELLED — requiere revisión manual`
        )
        return { outcome: "late_approval", order }
      }
      const paidAmount = Number.parseFloat(notification.amount)
      if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - order.total) > AMOUNT_TOLERANCE) {
        console.error(
          `[payment] Monto no coincide para pedido ${order.id}: pagado=${notification.amount}, esperado=${order.total}`
        )
        // El pedido queda PENDING para revisión manual.
        return { outcome: "amount_mismatch", order }
      }
      await changeOrderStatus(order.id, "PAID")
      const paidOrder = (await getOrderById(order.id)) ?? order
      runPostPaymentEffects(paidOrder)
      return { outcome: "paid", order: paidOrder }
    }
    case EpaycoStatus.REJECTED:
    case EpaycoStatus.FAILED: {
      if (order.paymentStatus === "APPROVED" || order.status === "PAID") {
        console.error(
          `[payment] Rechazo recibido para pedido ${order.id} ya pagado (ref=${notification.refPayco}) — ignorado, revisar manualmente`
        )
        return { outcome: "ignored_rejection", order }
      }
      if (order.status === "CANCELLED") {
        return { outcome: "already_cancelled", order }
      }
      const reason = notification.codResponse === EpaycoStatus.REJECTED ? "REJECTED" : "FAILED"
      await closeOrderWithoutPayment(order.id, reason)
      return { outcome: "rejected", order: (await getOrderById(order.id)) ?? order }
    }
    default:
      // PENDING (3) u otro código: el pedido sigue esperando confirmación.
      return { outcome: "pending", order }
  }
}

export type ReferencePaymentStatus = "approved" | "pending" | "rejected" | "unknown"

export interface ReferencePaymentResult {
  status: ReferencePaymentStatus
  order: { id: string; total: number } | null
}

function outcomeToStatus(outcome: PaymentOutcome): ReferencePaymentStatus {
  switch (outcome) {
    case "paid":
    case "already_paid":
    case "ignored_rejection":
      return "approved"
    case "rejected":
    case "already_cancelled":
      return "rejected"
    case "order_not_found":
      return "unknown"
    case "late_approval":
      // El cobro existe pero el pedido estaba cerrado: el cliente ve "en
      // proceso" mientras el admin lo revisa.
      return "pending"
    default:
      return "pending"
  }
}

/**
 * Confirma un pago a partir del `ref_payco` con el que ePayco redirige a la
 * página de respuesta. Consulta el resultado directamente a ePayco (no confía
 * en nada que venga del navegador) y lo aplica al pedido igual que el webhook,
 * así el cliente ve su pedido pagado aunque la confirmación server-to-server
 * todavía no haya llegado.
 */
export async function confirmPaymentByReference(
  refPayco: string,
  expectedOrderId?: string
): Promise<ReferencePaymentResult> {
  const transaction = await fetchEpaycoTransaction(refPayco)
  if (!transaction || !transaction.invoice) {
    return { status: "unknown", order: null }
  }
  if (expectedOrderId && transaction.invoice !== expectedOrderId) {
    console.error(
      `[payment] ref_payco ${refPayco} pertenece al pedido ${transaction.invoice}, no a ${expectedOrderId}`
    )
    return { status: "unknown", order: null }
  }

  const result = await applyPaymentNotification({
    orderId: transaction.invoice,
    refPayco: transaction.refPayco,
    amount: transaction.amount,
    codResponse: transaction.codResponse,
  })

  return {
    status: outcomeToStatus(result.outcome),
    order: result.order ? { id: result.order.id, total: result.order.total } : null,
  }
}
