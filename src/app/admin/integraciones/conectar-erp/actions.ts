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
  await requireSuperAdmin()
  return testErpConnection(provider, credentials)
}

export async function previewErpConnectionAction(
  provider: string,
  credentials: ErpCredentials
): Promise<ErpConnectionPreview | { error: string }> {
  await requireSuperAdmin()
  try {
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
  await requireSuperAdmin()
  try {
    for (const d of decisions) {
      await linkManualProduct(d.productId, d.erpBaseSku)
    }
    return { success: true, linkedCount: decisions.length }
  } catch (error: unknown) {
    return { success: false, linkedCount: 0, error: error instanceof Error ? error.message : "Error inesperado." }
  }
}
