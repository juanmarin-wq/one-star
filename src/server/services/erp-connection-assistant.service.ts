import "server-only"

import { createAdapterFromCredentials, type ErpCredentials } from "@/server/erp/adapter-factory"
import { findManualProductNames, updateProductSlug } from "@/server/repositories/product.repository"

export type { ErpCredentials }

function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

export interface ConnectionTestResult {
  success: boolean
  error?: string
}

/** Prueba credenciales en memoria, sin activar nada ni guardarlas. */
export async function testErpConnection(
  provider: string,
  credentials: ErpCredentials
): Promise<ConnectionTestResult> {
  try {
    const adapter = createAdapterFromCredentials(provider, credentials)
    const ok = await adapter.ping()
    return ok ? { success: true } : { success: false, error: "El ERP no respondió correctamente." }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error desconocido." }
  }
}

export interface ErpConnectionMatch {
  erpGroup: { erpId: string; sku: string; name: string }
  manualProduct: { id: string; name: string; slug: string }
}

export interface ErpConnectionPreview {
  supportsCatalog: boolean
  newCount: number
  matches: ErpConnectionMatch[]
}

/**
 * Trae el catálogo del ERP con las credenciales dadas y lo compara, por
 * nombre normalizado EXACTO (sin mayúsculas/tildes), contra los productos
 * cargados a mano. No escribe nada — solo informa.
 */
export async function previewErpConnection(
  provider: string,
  credentials: ErpCredentials
): Promise<ErpConnectionPreview> {
  const adapter = createAdapterFromCredentials(provider, credentials)
  if (!adapter.fetchCatalog) {
    return { supportsCatalog: false, newCount: 0, matches: [] }
  }

  const [snapshot, manualProducts] = await Promise.all([
    adapter.fetchCatalog(),
    findManualProductNames(),
  ])
  const manualByName = new Map(manualProducts.map((p) => [normalizeName(p.name), p]))

  const matches: ErpConnectionMatch[] = []
  let newCount = 0
  for (const group of snapshot.groups) {
    const manual = manualByName.get(normalizeName(group.name))
    if (manual) {
      matches.push({
        erpGroup: { erpId: group.erpId, sku: group.sku, name: group.name },
        manualProduct: manual,
      })
    } else {
      newCount++
    }
  }
  return { supportsCatalog: true, newCount, matches }
}

/**
 * Vincula un producto manual con un producto del ERP: cambia su slug al
 * código del ERP para que la próxima sincronización real lo reconozca como
 * el mismo producto en vez de duplicarlo. Cambia la URL pública del
 * producto — el caller debe advertirlo antes de confirmar.
 */
export async function linkManualProduct(productId: string, erpBaseSku: string): Promise<void> {
  await updateProductSlug(productId, erpBaseSku)
}
