"use server"

import {
  runErpEndpointDiagnostics,
  syncCatalogFromERP,
} from "@/server/services/erp-sync.service"
import { requireSuperAdmin, UnauthorizedError } from "@/server/auth/require-admin"
import { sanitizeErpError } from "@/server/erp/erp-error"
import { updateErpSyncSchedule } from "@/server/services/erp-sync-scheduler.service"
import type { ErpSyncConfigInput } from "@/server/validators/erp-sync-config.validator"

export async function syncCatalogAction() {
  try {
    await requireSuperAdmin()
    const result = await syncCatalogFromERP("MANUAL")
    return result
  } catch (error) {
    return { success: false, processedCount: 0, error: sanitizeErpError(error) }
  }
}

/** Probe explícito, autenticado y de solo lectura para el panel de integraciones. */
export async function diagnoseErpEndpointsAction() {
  try {
    await requireSuperAdmin()
    return await runErpEndpointDiagnostics()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        checkedAt: new Date().toISOString(),
        accessDenied: true as const,
        results: [],
      }
    }

    const detail = sanitizeErpError(error)
    return {
      checkedAt: new Date().toISOString(),
      results: (["connection", "catalog", "stock"] as const).map((endpoint) => ({
        endpoint,
        status: "error" as const,
        httpStatus: null,
        latencyMs: 0,
        detail,
      })),
    }
  }
}

/** Guarda la programación automática; la sincronización manual no depende de ella. */
export async function saveErpSyncConfigAction(input: ErpSyncConfigInput) {
  try {
    await requireSuperAdmin()
    const schedule = await updateErpSyncSchedule(input)
    return { success: true as const, schedule }
  } catch (error) {
    return { success: false as const, error: sanitizeErpError(error) }
  }
}
