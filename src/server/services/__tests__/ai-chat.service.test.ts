import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mockCreate = vi.hoisted(() => vi.fn())
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

vi.mock("../product.service", () => ({
  getProducts: vi.fn(),
}))
vi.mock("@/server/repositories/variant.repository", () => ({
  findVariantForCartDisplay: vi.fn(),
}))

import { getProducts } from "../product.service"
import { findVariantForCartDisplay } from "@/server/repositories/variant.repository"
import { sendChatMessage } from "../ai-chat.service"

const mockGetProducts = vi.mocked(getProducts)
const mockFindVariant = vi.mocked(findVariantForCartDisplay)

function decimal(n: number) {
  return { toNumber: () => n }
}

function textResponse(text: string) {
  return { content: [{ type: "text", text }] }
}

function toolUseResponse(name: string, input: Record<string, unknown>, id = "tool-1") {
  return { content: [{ type: "tool_use", id, name, input }] }
}

describe("sendChatMessage", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = "test-key"
  })

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it("se degrada con gracia sin ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const result = await sendChatMessage([], "hola")
    expect(result.actions).toEqual([])
    expect(result.reply).toContain("no está disponible")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("devuelve el texto del modelo cuando no usa herramientas", async () => {
    mockCreate.mockResolvedValue(textResponse("¡Hola! ¿En qué te ayudo?"))
    const result = await sendChatMessage([], "hola")
    expect(result.reply).toBe("¡Hola! ¿En qué te ayudo?")
    expect(result.actions).toEqual([])
  })

  it("ejecuta buscar_productos con datos reales y responde con el resultado final", async () => {
    mockGetProducts.mockResolvedValue({
      products: [
        {
          id: "p1",
          name: "Nike Pegasus 41",
          brand: "Nike",
          basePrice: 480000,
          isOnSale: false,
          salePrice: null,
          variants: [{ id: "v1", size: "42", color: "Negro", stock: 5 }],
        },
      ],
      total: 1,
    } as never)
    mockCreate
      .mockResolvedValueOnce(toolUseResponse("buscar_productos", { query: "pegasus" }))
      .mockResolvedValueOnce(textResponse("Tenemos la Nike Pegasus 41 en talla 42, $480.000."))

    const result = await sendChatMessage([], "¿tienen pegasus?")
    expect(mockGetProducts).toHaveBeenCalledWith({ q: "pegasus" }, 5)
    expect(result.reply).toContain("Pegasus")
    expect(result.actions).toEqual([])
  })

  it("agrega al carrito cuando hay stock suficiente", async () => {
    mockFindVariant.mockResolvedValue({
      id: "v1",
      sku: "NK-1",
      size: "42",
      color: "Negro",
      stock: 5,
      productId: "p1",
      product: {
        id: "p1",
        name: "Nike Pegasus 41",
        slug: "nike-pegasus-41",
        basePrice: decimal(480000),
        isOnSale: false,
        salePrice: null,
        isPublished: true,
        availableOnline: true,
        brand: { name: "Nike" },
        images: [{ url: "https://x.com/a.jpg" }],
      },
    } as never)
    mockCreate
      .mockResolvedValueOnce(toolUseResponse("agregar_al_carrito", { variantId: "v1", quantity: 1 }))
      .mockResolvedValueOnce(textResponse("Listo, lo agregué a tu carrito."))

    const result = await sendChatMessage([], "agrégala")
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      type: "add_to_cart",
      variantId: "v1",
      sku: "NK-1",
      price: 480000,
      quantity: 1,
    })
  })

  it("no agrega al carrito cuando no hay stock suficiente", async () => {
    mockFindVariant.mockResolvedValue({
      id: "v1",
      sku: "NK-1",
      size: "42",
      color: "Negro",
      stock: 0,
      productId: "p1",
      product: {
        id: "p1",
        name: "Nike Pegasus 41",
        slug: "nike-pegasus-41",
        basePrice: decimal(480000),
        isOnSale: false,
        salePrice: null,
        isPublished: true,
        availableOnline: true,
        brand: { name: "Nike" },
        images: [],
      },
    } as never)
    mockCreate
      .mockResolvedValueOnce(toolUseResponse("agregar_al_carrito", { variantId: "v1", quantity: 1 }))
      .mockResolvedValueOnce(textResponse("Esa talla está agotada."))

    const result = await sendChatMessage([], "agrégala")
    expect(result.actions).toEqual([])
  })

  it("responde con un mensaje amigable si la API de IA falla", async () => {
    mockCreate.mockRejectedValue(new Error("network down"))
    const result = await sendChatMessage([], "hola")
    expect(result.reply).toContain("problema")
    expect(result.actions).toEqual([])
  })
})
