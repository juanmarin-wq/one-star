import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { getProducts } from "./product.service"
import { findVariantForCartDisplay } from "@/server/repositories/variant.repository"

const DEFAULT_MODEL = "claude-sonnet-5"
const MAX_TOOL_ROUNDS = 4

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface CartAction {
  type: "add_to_cart"
  variantId: string
  productId: string
  sku: string
  name: string
  slug: string
  brand: string | null
  imageUrl: string | null
  size: string
  color: string
  price: number
  quantity: number
}

export interface ChatResult {
  reply: string
  actions: CartAction[]
}

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  return new Anthropic({ apiKey })
}

const SYSTEM_PROMPT = `Eres el asistente de ventas de One Star, una tienda de ropa y calzado deportivo/urbano en Colombia.
Ayudas a los visitantes a encontrar productos y armar su compra directamente en el chat.

Reglas estrictas:
- SIEMPRE usa las herramientas para consultar precio y stock reales antes de afirmar algo. Nunca inventes ni asumas disponibilidad o precios.
- Si algo no tiene stock, dilo con claridad; ofrece buscar una alternativa si tiene sentido.
- Los precios están en pesos colombianos (COP).
- Sé breve, cordial y directo — no insistas ni presiones la venta.
- Cuando agregues algo al carrito, dilo explícitamente e invita a revisar el carrito para pagar.
- No inventes políticas de envío, devoluciones ni promociones que no te haya dado una herramienta.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca en el catálogo publicado de One Star por nombre, marca o tipo de producto. Devuelve precio y, por cada variante (talla+color), su stock real.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de búsqueda, ej: 'Nike Pegasus' o 'tenis running hombre'" },
      },
      required: ["query"],
    },
  },
  {
    name: "agregar_al_carrito",
    description:
      "Agrega una variante (talla+color) específica al carrito del visitante. Usa el variantId que devolvió buscar_productos. Antes de llamarla, confirma con el cliente la talla/color exactos si hay duda.",
    input_schema: {
      type: "object",
      properties: {
        variantId: { type: "string" },
        quantity: { type: "number", description: "Cantidad a agregar, normalmente 1" },
      },
      required: ["variantId"],
    },
  },
]

async function runBuscarProductos(query: string) {
  const { products } = await getProducts({ q: query }, 5)
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    brand: p.brand,
    price: p.isOnSale && p.salePrice !== null ? p.salePrice : p.basePrice,
    enOferta: p.isOnSale,
    variantes: p.variants.map((v) => ({
      variantId: v.id,
      talla: v.size,
      color: v.color,
      stock: v.stock,
    })),
  }))
}

async function runAgregarAlCarrito(
  variantId: string,
  quantity: number
): Promise<{ result: Record<string, unknown>; action?: CartAction }> {
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1
  const variant = await findVariantForCartDisplay(variantId)

  if (!variant || !variant.product.isPublished || !variant.product.availableOnline) {
    return { result: { ok: false, error: "Ese producto ya no está disponible." } }
  }
  if (variant.stock < qty) {
    return {
      result: {
        ok: false,
        error: `Solo quedan ${variant.stock} unidad(es) disponibles de esa talla/color.`,
      },
    }
  }

  const price =
    variant.product.isOnSale && variant.product.salePrice !== null
      ? variant.product.salePrice.toNumber()
      : variant.product.basePrice.toNumber()

  const action: CartAction = {
    type: "add_to_cart",
    variantId: variant.id,
    productId: variant.product.id,
    sku: variant.sku,
    name: variant.product.name,
    slug: variant.product.slug,
    brand: variant.product.brand?.name ?? null,
    imageUrl: variant.product.images[0]?.url ?? null,
    size: variant.size,
    color: variant.color,
    price,
    quantity: qty,
  }

  return { result: { ok: true, agregado: action.name, talla: action.size, color: action.color, cantidad: qty }, action }
}

async function runTool(name: string, input: Record<string, unknown>): Promise<{ result: unknown; action?: CartAction }> {
  if (name === "buscar_productos") {
    return { result: await runBuscarProductos(String(input.query ?? "")) }
  }
  if (name === "agregar_al_carrito") {
    return runAgregarAlCarrito(String(input.variantId ?? ""), Number(input.quantity ?? 1))
  }
  return { result: { ok: false, error: "Herramienta desconocida." } }
}

/**
 * Sin ANTHROPIC_API_KEY configurada, el chat se degrada con un mensaje claro
 * en vez de romper la página — mismo patrón ya usado para Resend/ePayco.
 */
export async function sendChatMessage(history: ChatMessage[], message: string): Promise<ChatResult> {
  const client = getClient()
  if (!client) {
    return {
      reply: "El asistente de compras todavía no está disponible. Vuelve pronto — mientras tanto puedes explorar el catálogo normalmente.",
      actions: [],
    }
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ]

  const actions: CartAction[] = []

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      )

      if (toolUses.length === 0) {
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim()
        return { reply: text || "No tengo una respuesta clara para eso, ¿puedes contarme un poco más?", actions }
      }

      messages.push({ role: "assistant", content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        const { result, action } = await runTool(toolUse.name, (toolUse.input as Record<string, unknown>) ?? {})
        if (action) actions.push(action)
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }
      messages.push({ role: "user", content: toolResults })
    }

    return {
      reply: "Se me complicó terminar de resolver tu pedido — ¿puedes reformularlo o ser más específico?",
      actions,
    }
  } catch (err) {
    console.error("[ai-chat] Error consultando el modelo de IA:", err)
    return {
      reply: "Tuve un problema para responder justo ahora. Intenta de nuevo en un momento.",
      actions,
    }
  }
}
