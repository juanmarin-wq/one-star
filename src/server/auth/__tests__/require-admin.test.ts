import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))

const mockGetSession = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
}))

import { requireAdmin, requireSuperAdmin, getAdminRole, UnauthorizedError } from "../require-admin"

function sessionWith(userType?: string, adminRole?: string | null) {
  return { user: { userType, adminRole } }
}

describe("require-admin", () => {
  beforeEach(() => vi.clearAllMocks())

  describe("requireAdmin", () => {
    it("pasa con cualquier admin, sin importar el rol", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", "INVENTORY_OPERATOR"))
      await expect(requireAdmin()).resolves.toBeDefined()
    })

    it("rechaza sin sesión", async () => {
      mockGetSession.mockResolvedValue(null)
      await expect(requireAdmin()).rejects.toThrow(UnauthorizedError)
    })

    it("rechaza a un cliente", async () => {
      mockGetSession.mockResolvedValue(sessionWith("customer"))
      await expect(requireAdmin()).rejects.toThrow(UnauthorizedError)
    })
  })

  describe("requireSuperAdmin", () => {
    it("pasa con SUPER_ADMIN", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", "SUPER_ADMIN"))
      await expect(requireSuperAdmin()).resolves.toBeDefined()
    })

    it("rechaza a INVENTORY_OPERATOR", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", "INVENTORY_OPERATOR"))
      await expect(requireSuperAdmin()).rejects.toThrow(UnauthorizedError)
    })

    it("trata una sesión sin adminRole migrado como SUPER_ADMIN (no bloquea por accidente)", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", undefined))
      await expect(requireSuperAdmin()).resolves.toBeDefined()
    })

    it("rechaza sin sesión de admin", async () => {
      mockGetSession.mockResolvedValue(null)
      await expect(requireSuperAdmin()).rejects.toThrow(UnauthorizedError)
    })
  })

  describe("getAdminRole", () => {
    it("devuelve INVENTORY_OPERATOR cuando corresponde", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", "INVENTORY_OPERATOR"))
      expect(await getAdminRole()).toBe("INVENTORY_OPERATOR")
    })

    it("devuelve SUPER_ADMIN por defecto cuando falta el rol", async () => {
      mockGetSession.mockResolvedValue(sessionWith("admin", null))
      expect(await getAdminRole()).toBe("SUPER_ADMIN")
    })

    it("devuelve null sin sesión de admin", async () => {
      mockGetSession.mockResolvedValue(null)
      expect(await getAdminRole()).toBeNull()
    })
  })
})
