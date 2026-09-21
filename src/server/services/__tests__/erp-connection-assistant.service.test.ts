import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/server/erp/adapter-factory", () => ({
  createAdapterFromCredentials: vi.fn(),
}))
vi.mock("@/server/repositories/product.repository", () => ({
  findManualProductNames: vi.fn(),
  updateProductSlug: vi.fn(),
}))

import { createAdapterFromCredentials } from "@/server/erp/adapter-factory"
import { findManualProductNames, updateProductSlug } from "@/server/repositories/product.repository"
import {
  testErpConnection,
  previewErpConnection,
  linkManualProduct,
} from "../erp-connection-assistant.service"

const mockFactory = vi.mocked(createAdapterFromCredentials)
const mockFindManual = vi.mocked(findManualProductNames)
const mockUpdateSlug = vi.mocked(updateProductSlug)

describe("testErpConnection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve success cuando el ping responde bien", async () => {
    mockFactory.mockReturnValue({ ping: vi.fn().mockResolvedValue(true) } as never)
    const result = await testErpConnection("loggro", { apiToken: "x" })
    expect(result).toEqual({ success: true })
  })

  it("devuelve error cuando el ping responde mal", async () => {
    mockFactory.mockReturnValue({ ping: vi.fn().mockResolvedValue(false) } as never)
    const result = await testErpConnection("loggro", { apiToken: "x" })
    expect(result.success).toBe(false)
  })

  it("captura credenciales inválidas antes de intentar el catálogo", async () => {
    mockFactory.mockImplementation(() => {
      throw new Error("Falta el token de Loggro.")
    })
    const result = await testErpConnection("loggro", {})
    expect(result).toEqual({ success: false, error: "Falta el token de Loggro." })
  })
})

describe("previewErpConnection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("indica cuando el adaptador no soporta fetchCatalog", async () => {
    mockFactory.mockReturnValue({} as never)
    const result = await previewErpConnection("loggro", { apiToken: "x" })
    expect(result).toEqual({ supportsCatalog: false, newCount: 0, matches: [] })
  })

  it("marca como nuevo un producto del ERP sin coincidencia manual", async () => {
    mockFindManual.mockResolvedValue([])
    mockFactory.mockReturnValue({
      fetchCatalog: vi.fn().mockResolvedValue({ groups: [{ erpId: "e1", sku: "REF1", name: "Zapatilla X" }] }),
    } as never)
    const result = await previewErpConnection("loggro", { apiToken: "x" })
    expect(result.newCount).toBe(1)
    expect(result.matches).toEqual([])
  })

  it("detecta coincidencia exacta de nombre ignorando mayúsculas y tildes", async () => {
    mockFindManual.mockResolvedValue([{ id: "p1", name: "Zapatilla Ñandú", slug: "zapatilla-nandu" }])
    mockFactory.mockReturnValue({
      fetchCatalog: vi.fn().mockResolvedValue({ groups: [{ erpId: "e1", sku: "REF1", name: "zapatilla ñandu" }] }),
    } as never)
    const result = await previewErpConnection("loggro", { apiToken: "x" })
    expect(result.newCount).toBe(0)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].manualProduct.id).toBe("p1")
  })

  it("no empareja nombres distintos aunque sean parecidos", async () => {
    mockFindManual.mockResolvedValue([{ id: "p1", name: "Zapatilla Running Pro", slug: "zapatilla-running-pro" }])
    mockFactory.mockReturnValue({
      fetchCatalog: vi.fn().mockResolvedValue({ groups: [{ erpId: "e1", sku: "REF1", name: "Zapatilla Running" }] }),
    } as never)
    const result = await previewErpConnection("loggro", { apiToken: "x" })
    expect(result.newCount).toBe(1)
    expect(result.matches).toEqual([])
  })
})

describe("linkManualProduct", () => {
  it("cambia el slug del producto manual al código del ERP", async () => {
    mockUpdateSlug.mockResolvedValue(undefined as never)
    await linkManualProduct("p1", "REF1")
    expect(mockUpdateSlug).toHaveBeenCalledWith("p1", "REF1")
  })
})
