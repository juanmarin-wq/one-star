"use server"

import { requireSuperAdmin } from "@/server/auth/require-admin"
import {
  testErpConnection,
  previewErpConnection,
  linkManualProduct,
  type ErpCredentials,
  type ConnectionTestResult,
  type ErpConnectionPreview,
} from "@/server/services/erp-connection-assistant.service"

export async function testErpConnectionAction(
  provider: string,
  credentials: ErpCredentials
): Promise<ConnectionTestResult> {
  try {
    await requireSuperAdmin()
    return await testErpConnection(provider, credentials)
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : "Error inesperado." }
  }
}

export async function previewErpConnectionAction(
  provider: string,
  credentials: ErpCredentials
): Promise<ErpConnectionPreview | { error: string }> {
  try {
    await requireSuperAdmin()
    return await previewErpConnection(provider, credentials)
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Error inesperado." }
  }
}

export interface LinkDecision {
  productId: string
  erpBaseSku: string
}

export async function linkManualProductsAction(
  decisions: LinkDecision[]
): Promise<{ success: boolean; linkedCount: number; error?: string }> {
  let linkedCount = 0
  try {
    await requireSuperAdmin()
    for (const d of decisions) {
      await linkManualProduct(d.productId, d.erpBaseSku)
      linkedCount++
    }
    return { success: true, linkedCount }
  } catch (error: unknown) {
    // Cada vínculo ya hecho es permanente: se informa cuántos quedaron aplicados.
    const detail = error instanceof Error ? error.message : "Error inesperado."
    return {
      success: false,
      linkedCount,
      error:
        linkedCount > 0
          ? `Se vincularon ${linkedCount} producto(s) y luego falló: ${detail}`
          : detail,
    }
  }
}
