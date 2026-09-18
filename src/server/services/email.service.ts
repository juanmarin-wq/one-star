import "server-only"
import { sendEmail, type SendEmailResult } from "@/server/email/resend.client"
import {
  loginAlertEmail,
  orderConfirmationEmail,
  giftCardDeliveryEmail,
  type OrderEmailItem,
  type GiftCardEmailCard,
} from "@/server/email/templates"

export type { OrderEmailItem, GiftCardEmailCard }

const BOGOTA_TZ = "America/Bogota"

/** Envía el correo de alerta de inicio de sesión a un cliente. */
export async function sendLoginAlertEmail(params: {
  email: string
  name?: string
}): Promise<SendEmailResult> {
  const whenLabel = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: BOGOTA_TZ,
  }).format(new Date())

  const { subject, html } = loginAlertEmail({ name: params.name, whenLabel })
  return sendEmail({ to: params.email, subject, html })
}

/** Envía el correo de confirmación de compra al cliente. */
export async function sendOrderConfirmationEmail(params: {
  email: string
  name?: string
  orderId: string
  items: OrderEmailItem[]
  total: number
}): Promise<SendEmailResult> {
  const { subject, html } = orderConfirmationEmail({
    name: params.name,
    orderId: params.orderId,
    items: params.items,
    total: params.total,
  })
  return sendEmail({ to: params.email, subject, html })
}

/** Envía el correo con el/los código(s) de tarjeta de regalo recién emitidos. */
export async function sendGiftCardEmail(params: {
  email: string
  name?: string
  orderId: string
  cards: GiftCardEmailCard[]
}): Promise<SendEmailResult> {
  const { subject, html } = giftCardDeliveryEmail({
    name: params.name,
    orderId: params.orderId,
    cards: params.cards,
  })
  return sendEmail({ to: params.email, subject, html })
}
