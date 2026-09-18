/**
 * Plantillas HTML de los correos transaccionales de One Star.
 * HTML "email-safe": tablas + estilos inline (compatibilidad con clientes de correo).
 */

export interface EmailContent {
  subject: string
  html: string
}

export interface OrderEmailItem {
  productName: string
  quantity: number
  /** Precio unitario en COP */
  unitPrice: number
}

const COLOR = {
  dark: "#1C1C1C",
  bg: "#F5F5F5",
  card: "#FFFFFF",
  text: "#1C1C1C",
  muted: "#6B7280",
  border: "#E5E7EB",
  accentBg: "#F3F4F6",
}

const currencyCOP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

function formatCOP(value: number): string {
  return currencyCOP.format(value)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Envuelve el contenido en el layout de marca (cabecera + footer). */
function layout(innerHtml: string, preheader: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:${COLOR.card};border-radius:14px;overflow:hidden;border:1px solid ${COLOR.border};">
      <tr>
        <td style="background:${COLOR.dark};padding:22px 32px;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:2px;color:#FFFFFF;">ONE STAR</span>
        </td>
      </tr>
      <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:${COLOR.text};">
        ${innerHtml}
      </td></tr>
      <tr>
        <td style="padding:20px 32px;background:${COLOR.accentBg};border-top:1px solid ${COLOR.border};font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLOR.muted};">
          One Star — Urban Performance. Este es un correo automático, por favor no respondas.
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function greeting(name?: string): string {
  const safe = name ? escapeHtml(name.split(" ")[0]) : null
  return safe ? `Hola ${safe},` : "Hola,"
}

/** Correo de alerta cuando el usuario inicia sesión. */
export function loginAlertEmail(params: { name?: string; whenLabel: string }): EmailContent {
  const inner = `
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Nuevo inicio de sesión</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.text};">${greeting(params.name)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.text};">
      Detectamos un inicio de sesión en tu cuenta de One Star el
      <strong>${escapeHtml(params.whenLabel)}</strong>.
    </p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:${COLOR.muted};">
      Si fuiste tú, no tienes que hacer nada. Si no reconoces esta actividad,
      te recomendamos cambiar tu contraseña cuanto antes.
    </p>`
  return {
    subject: "Nuevo inicio de sesión en tu cuenta One Star",
    html: layout(inner, "Detectamos un inicio de sesión en tu cuenta One Star."),
  }
}

/** Correo de confirmación de compra. */
export function orderConfirmationEmail(params: {
  name?: string
  orderId: string
  items: OrderEmailItem[]
  total: number
}): EmailContent {
  const rows = params.items
    .map(
      (item) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${COLOR.border};font-size:14px;color:${COLOR.text};">
          ${escapeHtml(item.productName)}
          <span style="color:${COLOR.muted};"> × ${item.quantity}</span>
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${COLOR.border};font-size:14px;color:${COLOR.text};white-space:nowrap;">
          ${formatCOP(item.unitPrice * item.quantity)}
        </td>
      </tr>`
    )
    .join("")

  const shortId = params.orderId.slice(-8).toUpperCase()

  const inner = `
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">¡Gracias por tu compra!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.text};">${greeting(params.name)}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${COLOR.text};">
      Recibimos tu pedido <strong>#${escapeHtml(shortId)}</strong>. Aquí está el resumen:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      ${rows}
      <tr>
        <td style="padding:16px 0 0;font-size:16px;font-weight:700;color:${COLOR.text};">Total</td>
        <td align="right" style="padding:16px 0 0;font-size:16px;font-weight:700;color:${COLOR.text};white-space:nowrap;">
          ${formatCOP(params.total)}
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:${COLOR.muted};">
      Te avisaremos cuando tu pedido sea despachado. ¡Gracias por confiar en One Star!
    </p>`

  return {
    subject: `Confirmación de tu pedido One Star #${shortId}`,
    html: layout(inner, `Recibimos tu pedido #${shortId}. Total: ${formatCOP(params.total)}.`),
  }
}

export interface GiftCardEmailCard {
  code: string
  balance: number
}

export function giftCardDeliveryEmail(params: {
  name?: string
  orderId: string
  cards: GiftCardEmailCard[]
}): EmailContent {
  const shortId = params.orderId.slice(-8).toUpperCase()
  const plural = params.cards.length > 1

  const cardsHtml = params.cards
    .map(
      (card) => `
      <tr>
        <td style="padding:16px;border:1px dashed ${COLOR.border};border-radius:8px;">
          <div style="font-size:12px;letter-spacing:0.05em;color:${COLOR.muted};text-transform:uppercase;">Código</div>
          <div style="font-size:20px;font-weight:700;letter-spacing:0.05em;color:${COLOR.text};margin:4px 0 8px;">${escapeHtml(card.code)}</div>
          <div style="font-size:14px;color:${COLOR.text};">Saldo: <strong>${formatCOP(card.balance)}</strong></div>
        </td>
      </tr>
      <tr><td style="height:12px;"></td></tr>`
    )
    .join("")

  const inner = `
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${plural ? "Tus tarjetas de regalo" : "Tu tarjeta de regalo"}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.text};">${greeting(params.name)}</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${COLOR.text};">
      Gracias por tu compra <strong>#${escapeHtml(shortId)}</strong>. ${plural ? "Aquí están tus códigos" : "Aquí está tu código"}
      para usar en cualquier tienda física o al comprar de nuevo en línea One Star:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${cardsHtml}
    </table>
    <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:${COLOR.muted};">
      Guarda este correo: el código es la única forma de usar el saldo.
    </p>`

  return {
    subject: plural
      ? `Tus tarjetas de regalo One Star #${shortId}`
      : `Tu tarjeta de regalo One Star #${shortId}`,
    html: layout(inner, plural ? "Tus tarjetas de regalo ya están listas." : "Tu tarjeta de regalo ya está lista."),
  }
}
