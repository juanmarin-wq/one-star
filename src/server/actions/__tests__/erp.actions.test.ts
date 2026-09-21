import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSuperAdmin: vi.fn(),
    runErpEndpointDiagnostics: vi.fn(),
    updateErpSyncSchedule: vi.fn(),
    syncCatalogFromERP: vi.fn(),
  }
})

vi.mock("@/server/auth/require-admin", () => ({
  UnauthorizedError: mocks.UnauthorizedError,
  requireSuperAdmin: mocks.requireSuperAdmin,
}))
vi.mock("@/server/services/erp-sync.service", () => ({
  runErpEndpointDiagnostics: mocks.runErpEndpointDiagnostics,
  syncCatalogFromERP: mocks.syncCatalogFromERP,
}))
vi.mock("@/server/services/erp-sync-scheduler.service", () => ({
  updateErpSyncSchedule: mocks.updateErpSyncSchedule,
}))

import {
  diagnoseErpEndpointsAction,
  saveErpSyncConfigAction,
  syncCatalogAction,
} from "../erp.actions"

describe("diagnoseErpEndpointsAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no ejecuta el diagnóstico cuando no hay sesión admin", async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new mocks.UnauthorizedError("No autorizado."))

    const result = await diagnoseErpEndpointsAction()

    expect(mocks.runErpEndpointDiagnostics).not.toHaveBeenCalled()
    expect(result).toMatchObject({ accessDenied: true, results: [] })
  })

  it("modela una sesión expirada como acceso denegado y no como fallo ERP", async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new mocks.UnauthorizedError("Sesión expirada"))

    const result = await diagnoseErpEndpointsAction()

    expect(mocks.runErpEndpointDiagnostics).not.toHaveBeenCalled()
    expect(result.results).toEqual([])
    expect(result).not.toHaveProperty("detail")
  })

  it("ejecuta el diagnóstico únicamente después de autorizar al admin", async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ user: { userType: "admin" } })
    mocks.runErpEndpointDiagnostics.mockResolvedValue({
      checkedAt: "2026-08-06T12:00:00.000Z",
      results: [],
    })

    const result = await diagnoseErpEndpointsAction()

    expect(mocks.requireSuperAdmin).toHaveBeenCalledOnce()
    expect(mocks.runErpEndpointDiagnostics).toHaveBeenCalledOnce()
    expect(result).not.toHaveProperty("accessDenied")
  })
})

describe("saveErpSyncConfigAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no persiste cambios cuando no hay sesión administrativa", async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new mocks.UnauthorizedError("No autorizado."))

    const result = await saveErpSyncConfigAction({ enabled: false, intervalMinutes: 30 })

    expect(result).toMatchObject({ success: false })
    expect(mocks.updateErpSyncSchedule).not.toHaveBeenCalled()
  })

  it("guarda únicamente después de autorizar al administrador", async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ user: { userType: "admin" } })
    mocks.updateErpSyncSchedule.mockResolvedValue({
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: "2026-08-06T13:00:00.000Z",
    })

    const result = await saveErpSyncConfigAction({ enabled: true, intervalMinutes: 60 })

    expect(result).toMatchObject({ success: true })
    expect(mocks.requireSuperAdmin).toHaveBeenCalledOnce()
    expect(mocks.updateErpSyncSchedule).toHaveBeenCalledWith({
      enabled: true,
      intervalMinutes: 60,
    })
  })

  it("devuelve al panel la explicación cuando el ERP impide activar el automático", async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ user: { userType: "admin" } })
    mocks.updateErpSyncSchedule.mockRejectedValue(
      new Error(
        "El ERP configurado no ofrece sincronización de catálogo. Conecta un ERP compatible antes de activar la programación automática."
      )
    )

    await expect(
      saveErpSyncConfigAction({ enabled: true, intervalMinutes: 60 })
    ).resolves.toEqual({
      success: false,
      error:
        "El ERP configurado no ofrece sincronización de catálogo. Conecta un ERP compatible antes de activar la programación automática.",
    })
  })

  it("mantiene disponible la sincronización manual sin consultar la programación", async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ user: { userType: "admin" } })
    mocks.syncCatalogFromERP.mockResolvedValue({ success: true, processedCount: 2 })

    await expect(syncCatalogAction()).resolves.toMatchObject({ success: true })

    expect(mocks.syncCatalogFromERP).toHaveBeenCalledWith("MANUAL")
    expect(mocks.updateErpSyncSchedule).not.toHaveBeenCalled()
  })
})
