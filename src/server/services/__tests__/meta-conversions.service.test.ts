import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

vi.mock("server-only", () => ({}))

vi.mock("@/server/services/store-settings.service", () => ({
  getMetaConversionsCredentials: vi.fn(),
}))

import {
  buildPurchasePayload,
  hashForMeta,
  normalizePhoneForMeta,
  purchaseInputFromOrder,
  sendMetaPurchaseEvent,
  type MetaPurchaseInput,
} from "../meta-conversions.service"
import { getMetaConversionsCredentials } from "@/server/services/store-settings.service"
import type { OrderDTO } from "@/server/services/order.service"

const mockCredentials = vi.mocked(getMetaConversionsCredentials)

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const purchaseInput: MetaPurchaseInput = {
  orderId: "order-123",
  total: 250000,
  email: "  Cliente@Example.com ",
  fullName: "Ana María Pérez",
  phone: "300 123 4567",
  userId: "user-1",
  items: [
    { productId: "prod-a", quantity: 2, unitPrice: 100000 },
    { productId: "prod-b", quantity: 1, unitPrice: 50000 },
  ],
  eventTime: new Date("2026-09-04T12:00:00Z"),
}

describe("hashForMeta", () => {
  it("normaliza a minúsculas sin espacios antes de hashear", () => {
    expect(hashForMeta("  Cliente@Example.com ")).toBe(sha256("cliente@example.com"))
  })
})

describe("normalizePhoneForMeta", () => {
  it("antepone el indicativo 57 a un celular colombiano de 10 dígitos", () => {
    expect(normalizePhoneForMeta("300 123 4567")).toBe("573001234567")
  })

  it("respeta un número que ya trae indicativo", () => {
    expect(normalizePhoneForMeta("+57 300 123 4567")).toBe("573001234567")
  })

  it("descarta números demasiado cortos", () => {
    expect(normalizePhoneForMeta("12345")).toBeNull()
  })
})

describe("buildPurchasePayload", () => {
  it("usa el id del pedido como event_id y hashea todos los datos personales", () => {
    const payload = buildPurchasePayload(purchaseInput, {
      testEventCode: "TEST9",
      sourceUrl: "https://tienda.test/checkout/success",
    })

    expect(payload.test_event_code).toBe("TEST9")
    const [event] = payload.data
    expect(event.event_name).toBe("Purchase")
    expect(event.event_id).toBe("order-123")
    expect(event.event_time).toBe(Math.floor(Date.UTC(2026, 8, 4, 12) / 1000))
    expect(event.action_source).toBe("website")
    expect(event.event_source_url).toBe("https://tienda.test/checkout/success")

    expect(event.user_data.em).toEqual([sha256("cliente@example.com")])
    expect(event.user_data.ph).toEqual([sha256("573001234567")])
    expect(event.user_data.fn).toEqual([sha256("ana")])
    expect(event.user_data.ln).toEqual([sha256("maría pérez")])
    expect(event.user_data.external_id).toEqual([sha256("user-1")])

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("example.com")
    expect(serialized).not.toContain("Ana")
    expect(serialized).not.toContain("3001234567")
  })

  it("arma custom_data con contenidos, total y cantidad", () => {
    const [event] = buildPurchasePayload(purchaseInput).data

    expect(event.custom_data).toEqual({
      currency: "COP",
      value: 250000,
      content_type: "product",
      content_ids: ["prod-a", "prod-b"],
      contents: [
        { id: "prod-a", quantity: 2, item_price: 100000 },
        { id: "prod-b", quantity: 1, item_price: 50000 },
      ],
      num_items: 3,
      order_id: "order-123",
    })
    expect(event.event_source_url).toBeUndefined()
  })

  it("omite los campos de usuario que no existen", () => {
    const [event] = buildPurchasePayload({
      ...purchaseInput,
      email: null,
      fullName: null,
      phone: null,
      userId: null,
    }).data

    expect(event.user_data).toEqual({ country: [sha256("co")] })
  })
})

describe("purchaseInputFromOrder", () => {
  const order: OrderDTO = {
    id: "order-9",
    status: "PAID",
    paymentStatus: "APPROVED",
    paymentReference: "ref-9",
    paidAt: "2024-01-01T00:00:00.000Z",
    total: 120000,
    paymentMethod: "epayco",
    trackingNumber: null,
    customerEmail: null,
    customerName: "Luis Gómez",
    shippingAddress: { phone: "3009876543", city: "Bogotá" },
    userId: "user-9",
    userEmail: "luis@example.com",
    createdAt: "2026-09-04T00:00:00Z",
    updatedAt: "2026-09-04T00:00:00Z",
    items: [
      {
        id: "item-1",
        productId: "prod-z",
        productName: "Zapatilla",
        productImage: null,
        quantity: 1,
        unitPrice: 120000,
        sku: null,
      },
    ],
  }

  it("toma el teléfono del shippingAddress y el email de la cuenta como respaldo", () => {
    expect(purchaseInputFromOrder(order)).toEqual({
      orderId: "order-9",
      total: 120000,
      email: "luis@example.com",
      fullName: "Luis Gómez",
      phone: "3009876543",
      userId: "user-9",
      items: [{ productId: "prod-z", quantity: 1, unitPrice: 120000 }],
    })
  })

  it("tolera pedidos sin items ni dirección", () => {
    const input = purchaseInputFromOrder({ ...order, items: undefined, shippingAddress: null })

    expect(input.items).toEqual([])
    expect(input.phone).toBeNull()
  })
})

describe("sendMetaPurchaseEvent", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubEnv("BETTER_AUTH_URL", "https://tienda.test/")
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("no llama a Meta cuando no hay credenciales", async () => {
    mockCredentials.mockResolvedValue(null)

    await expect(sendMetaPurchaseEvent(purchaseInput)).resolves.toEqual({
      sent: false,
      reason: "not-configured",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("envía el evento al píxel configurado con el token en el cuerpo", async () => {
    mockCredentials.mockResolvedValue({
      pixelId: "555",
      accessToken: "tok",
      testEventCode: null,
    })
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" })

    await expect(sendMetaPurchaseEvent(purchaseInput)).resolves.toEqual({ sent: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://graph.facebook.com/v21.0/555/events")
    expect(init.method).toBe("POST")
    const body = JSON.parse(String(init.body))
    expect(body.access_token).toBe("tok")
    expect(body.test_event_code).toBeUndefined()
    expect(body.data[0].event_source_url).toBe("https://tienda.test/checkout/success")
  })

  it("reporta el error HTTP sin lanzar", async () => {
    mockCredentials.mockResolvedValue({
      pixelId: "555",
      accessToken: "tok",
      testEventCode: null,
    })
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "bad token" })
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendMetaPurchaseEvent(purchaseInput)).resolves.toEqual({
      sent: false,
      reason: "http-error",
      detail: "bad token",
    })
    consoleError.mockRestore()
  })

  it("reporta fallos de red sin lanzar", async () => {
    mockCredentials.mockResolvedValue({
      pixelId: "555",
      accessToken: "tok",
      testEventCode: null,
    })
    fetchMock.mockRejectedValue(new Error("timeout"))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(sendMetaPurchaseEvent(purchaseInput)).resolves.toEqual({
      sent: false,
      reason: "request-failed",
      detail: "timeout",
    })
    consoleError.mockRestore()
  })
})
