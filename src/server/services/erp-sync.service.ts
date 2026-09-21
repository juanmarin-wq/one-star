import "server-only"
import { getERPAdapter, supportsCatalogSync } from "@/server/erp"
import type { ErpSyncLog, ErpSyncTrigger } from "@prisma/client"
import type {
  ERPCatalogProductGroup,
  ERPCatalogSyncResult,
  ERPCatalogVariant,
  ERPEndpointDiagnostic,
  ERPEndpointDiagnostics,
} from "@/server/erp/erp.types"
import { sanitizeErpError } from "@/server/erp/erp-error"
import { parseSku, DEFAULT_SIZE } from "@/lib/sku"
import { detectColorFromText } from "@/lib/color-detect"
import { isRealColor } from "@/lib/colors"
import { findManyProductColors } from "@/server/repositories/product-color.repository"
import {
  createErpSyncLog,
  findRecentErpSyncLogs,
} from "@/server/repositories/erp-sync-log.repository"
import {
  createCatalogProduct,
  createCatalogVariant,
  createDefaultImportCategory,
  ensureCatalogBrand,
  ensureCatalogCategory,
  findCatalogProductBySlug,
  findDefaultImportCategory,
  fillMissingCatalogProductGenders,
  replaceErpInventoryLevels,
  updateCatalogProduct,
  updateCatalogVariant,
  type ErpInventoryLevelRow,
} from "@/server/repositories/erp-catalog.repository"
import { ensureErpStoreLocations } from "@/server/repositories/store.repository"
import { applyErpColorFamilyKeyUpdates } from "@/server/repositories/erp-color-family.repository"
import { getErpSyncSchedule } from "@/server/services/erp-sync-scheduler.service"
import type { ErpSyncInterval } from "@/lib/erp-sync-schedule"

export interface CatalogSyncOptions {
  /** Descarga y valida el catálogo, pero no escribe en PostgreSQL. */
  dryRun?: boolean
}

/** Máximo que esperamos por el healthcheck del ERP antes de darlo por caído. */
const PING_TIMEOUT_MS = 5000
/** Evita solapamientos entre cron y sincronización manual dentro del proceso. */
let catalogSyncInProgress = false

type WritableCatalogVariant = Omit<ERPCatalogVariant, "stock"> & { stock: number }
type WritableCatalogGroup = Omit<ERPCatalogProductGroup, "variants"> & {
  variants: WritableCatalogVariant[]
}

/**
 * Convierte el snapshot validado a su forma escribible. El cast está respaldado
 * por la comprobación exhaustiva de todos los stocks antes de tocar la BD.
 */
function getWritableGroups(groups: ERPCatalogProductGroup[]): WritableCatalogGroup[] | null {
  const hasUnknownStock = groups.some((group) =>
    group.variants.some((variant) => variant.stock === null)
  )
  return hasUnknownStock ? null : (groups as WritableCatalogGroup[])
}

function erpProviderName(): string {
  return (process.env.ERP_PROVIDER ?? "null").toLowerCase().trim()
}

function sanitizeCatalogSyncResult(result: ERPCatalogSyncResult): ERPCatalogSyncResult {
  return {
    ...result,
    error: result.error == null ? undefined : sanitizeErpError(result.error),
    warnings: result.warnings?.map(sanitizeErpError),
  }
}

/**
 * Sincroniza el catálogo desde el ERP y registra el resultado en la BD para
 * alimentar el panel de estado e historial de /admin/integraciones.
 *
 * @param trigger Quién disparó la sincronización (manual desde el panel o AUTO por cron).
 */
export async function syncCatalogFromERP(
  trigger: ErpSyncTrigger = "AUTO",
  options: CatalogSyncOptions = {}
): Promise<ERPCatalogSyncResult> {
  if (catalogSyncInProgress) {
    return {
      success: false,
      processedCount: 0,
      dryRun: options.dryRun ?? false,
      error: "ya hay una sincronización del catálogo en curso. Intenta nuevamente al finalizar.",
    }
  }

  catalogSyncInProgress = true
  try {
    const startedAt = Date.now()
    const result = sanitizeCatalogSyncResult(await runCatalogSync(options))

    if (!options.dryRun) {
      try {
        await createErpSyncLog({
          provider: erpProviderName(),
          trigger,
          success: result.success,
          processedCount: result.processedCount,
          error: result.error ?? null,
          durationMs: Date.now() - startedAt,
        })
      } catch (logErr) {
        console.error("[ERP Sync Service] No se pudo guardar el registro de sincronización:", logErr)
      }
    }

    return result
  } finally {
    catalogSyncInProgress = false
  }
}

/**
 * Sincroniza el catálogo de productos desde el ERP activo hacia la base de datos local.
 * Si el adaptador actual no soporta `fetchCatalog`, falla pacíficamente.
 */
async function runCatalogSync(options: CatalogSyncOptions): Promise<ERPCatalogSyncResult> {
  const adapter = getERPAdapter()

  if (!adapter.fetchCatalog) {
    return {
      success: false,
      processedCount: 0,
      error: "El ERP configurado no soporta la descarga completa del catálogo (fetchCatalog no implementado).",
    }
  }

  try {
    const snapshot = await adapter.fetchCatalog()
    const productCount = snapshot.diagnostics.groupCount
    const variantCount = snapshot.diagnostics.variantCount
    const definitionCount = snapshot.diagnostics.definitionCount

    // Un catálogo vacío casi siempre significa avería (credenciales, permisos o
    // un fallo del ERP), no "no hay productos". Se reporta como ERROR: marcarlo
    // como éxito dejaba el panel en verde mientras nada se sincronizaba.
    if (snapshot.groups.length === 0) {
      return {
        success: false,
        processedCount: 0,
        productCount,
        variantCount,
        definitionCount,
        dryRun: options.dryRun ?? false,
        error:
          "El ERP devolvió 0 productos. Revisa que el catálogo tenga ítems y que la integración esté operativa.",
      }
    }

    if (snapshot.stock.status === "partial") {
      return {
        success: false,
        processedCount: 0,
        productCount,
        variantCount,
        definitionCount,
        dryRun: options.dryRun ?? false,
        warnings: snapshot.stock.errors,
        error:
          `La consulta de stock fue parcial (${snapshot.stock.resolvedCount}/${snapshot.stock.requestedCount} SKU). ` +
          "Se conservó el inventario existente.",
      }
    }

    // Un catálogo entero en cero ya no detiene la importación. La regla de
    // publicación de abajo despublica todo lo que llegue sin existencias, así
    // que la tienda nunca ofrece algo que no se pueda vender. La respuesta
    // PARCIAL sí sigue bloqueando: ahí el ERP no dijo cuánto hay, y escribir
    // ceros borraría inventario real.
    const warnings: string[] = []
    if (snapshot.stock.status === "all_zero") {
      warnings.push(
        "El ERP reportó stock cero para todo el catálogo. " +
          "Los productos se importaron, pero quedaron despublicados."
      )
    }

    const writableGroups = getWritableGroups(snapshot.groups)
    if (!writableGroups) {
      return {
        success: false,
        processedCount: 0,
        productCount,
        variantCount,
        definitionCount,
        dryRun: options.dryRun ?? false,
        error: "El catálogo contiene variantes cuyo stock es desconocido. No se aplicaron cambios.",
      }
    }

    if (options.dryRun) {
      return {
        success: true,
        processedCount: productCount,
        productCount,
        variantCount,
        definitionCount,
        dryRun: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    }

    if (process.env.ERP_CATALOG_WRITES_ENABLED !== "true") {
      return {
        success: false,
        processedCount: 0,
        productCount,
        variantCount,
        definitionCount,
        dryRun: false,
        error:
          "Las escrituras del catálogo están pausadas mientras se valida y repara la importación existente. " +
          "Usa dry-run o habilita ERP_CATALOG_WRITES_ENABLED cuando la reparación haya sido aprobada.",
      }
    }

    // Buscar la categoría "Por Defecto" o crearla para asignar nuevos productos
    let defaultCategory = await findDefaultImportCategory()

    if (!defaultCategory) {
      defaultCategory = await createDefaultImportCategory()
    }

    // Paleta activa: permite deducir el color de cada variante desde el texto
    // que envía el ERP. Se lee una sola vez por sincronización.
    const paletteNames = (await findManyProductColors(true)).map((c) => c.name)

    // Sedes del ERP → tiendas físicas de la web. Se crean ocultas si no existen,
    // para que el desglose por sede quede guardado desde la primera sincronización.
    const erpLocations = snapshot.locations ?? []
    const storeIdByErpId = await ensureErpStoreLocations(erpLocations)
    const inventoryRows: ErpInventoryLevelRow[] = []
    const suggestedBrandIds = new Map<string, string>()
    const suggestedCategoryIds = new Map<string, string>()
    const colorFamilyKeyUpdates: Array<{ productId: string; key: string | null }> = []
    const genderCandidates: Array<{
      erpId: string
      gender: NonNullable<ERPCatalogProductGroup["gender"]>
    }> = []

    // El adaptador ya normalizó el catálogo plano del ERP en productos padre
    // con variantes vendibles. El servicio no conoce campos propios de Loggro.
    let unpublishedByStock = 0

    for (const group of writableGroups) {
      const baseSku = group.sku
      const variantsList = group.variants

      // Regla de publicación: un producto solo se ofrece si el ERP reporta
      // existencias. Cuando el propio ERP ya lo marcó como no vendible en
      // línea (obsequios, ítems internos, precio no positivo) la decisión del
      // administrador se conserva intacta y el stock no la reabre.
      const erpStock = variantsList.reduce((total, variant) => total + variant.stock, 0)
      const publishedByErp = group.onlineCatalogExclusionReason ? undefined : erpStock > 0
      if (publishedByErp === false) unpublishedByStock++

      // Buscar si el producto principal ya existe
      let existingProduct = await findCatalogProductBySlug(baseSku)
      let suggestedCategoryId: string | undefined
      if (group.categorySuggestion && !existingProduct) {
        suggestedCategoryId = suggestedCategoryIds.get(group.categorySuggestion.slug)
        if (!suggestedCategoryId) {
          const category = await ensureCatalogCategory(group.categorySuggestion)
          suggestedCategoryId = category.id
          suggestedCategoryIds.set(group.categorySuggestion.slug, category.id)
        }
      }

      let suggestedBrandId: string | null = null
      if (group.brandSuggestion && !existingProduct) {
        suggestedBrandId = suggestedBrandIds.get(group.brandSuggestion.slug) ?? null
        if (!suggestedBrandId) {
          const brand = await ensureCatalogBrand(group.brandSuggestion)
          suggestedBrandId = brand.id
          suggestedBrandIds.set(group.brandSuggestion.slug, brand.id)
        }
      }

      if (existingProduct) {
        // Actualizar datos base del producto
        const baseUpdate = {
          basePrice: group.basePrice,
          unitOfMeasure: group.unitOfMeasure,
          ...(publishedByErp === undefined ? {} : { isPublished: publishedByErp }),
        }
        if (existingProduct.erpId === null) {
          // Completa el erpId de un producto manual ya vinculado (por slug)
          // al código del ERP; nunca pisa uno que ya tenía asignado. Si ese
          // erpId ya pertenece a otro producto (P2002) se omite solo el
          // vínculo, sin abortar la sincronización del resto del catálogo.
          try {
            await updateCatalogProduct(existingProduct.id, { ...baseUpdate, erpId: group.erpId })
          } catch (error: unknown) {
            if ((error as { code?: string }).code !== "P2002") throw error
            console.error(
              `[erp-sync] erpId ${group.erpId} ya está asignado a otro producto; no se vincula "${baseSku}"`
            )
            await updateCatalogProduct(existingProduct.id, baseUpdate)
          }
        } else {
          await updateCatalogProduct(existingProduct.id, baseUpdate)
        }
        if (existingProduct.gender == null && group.gender) {
          genderCandidates.push({ erpId: group.erpId, gender: group.gender })
        }
      } else {
        // Crear el producto principal
        existingProduct = await createCatalogProduct({
          name: group.name.split("-")[0].trim(), // Intentar limpiar el nombre
          slug: baseSku,
          basePrice: group.basePrice,
          unitOfMeasure: group.unitOfMeasure,
          categoryId: suggestedCategoryId ?? defaultCategory.id,
          brandId: suggestedBrandId,
          gender: group.gender,
          isPublished: publishedByErp ?? false,
          erpId: group.erpId,
        })
      }

      // 3. Sincronizar las Variantes de este producto
      for (const variantItem of variantsList) {
        const existingVariant = existingProduct.variants.find((v) => v.sku === variantItem.sku)
        
        // La talla sale del propio SKU (ver `parseSku`).
        const { size } = parseSku(variantItem.sku)

        // El ERP no expone el color como campo, pero lo menciona en la
        // descripción ("TENIS HOKA BONDI 9 NEGRO"): se deduce contra la paleta
        // administrable. Si no se reconoce, queda vacío para asignarlo a mano.
        const detectedColor =
          detectColorFromText(variantItem.detailedName, paletteNames) ??
          detectColorFromText(variantItem.name, paletteNames) ??
          ""

        let variantId: string
        if (existingVariant) {
          await updateCatalogVariant(existingVariant.id, {
            erpId: variantItem.erpId,
            stock: variantItem.stock,
            size: size !== DEFAULT_SIZE ? size : existingVariant.size,
            // Nunca se pisa un color ya asignado: el admin manda sobre el ERP.
            ...(isRealColor(existingVariant.color) || !detectedColor
              ? {}
              : { color: detectedColor }),
          })
          variantId = existingVariant.id
        } else {
          const created = await createCatalogVariant({
            productId: existingProduct.id,
            sku: variantItem.sku,
            erpId: variantItem.erpId,
            size,
            color: detectedColor,
            stock: variantItem.stock,
          })
          variantId = created.id
        }

        // Desglose por sede: solo informativo para el cliente (no reserva ni
        // recogida en tienda). El total vendible sigue siendo `stock`.
        for (const level of variantItem.stockByLocation ?? []) {
          const storeLocationId = storeIdByErpId.get(level.locationErpId)
          if (!storeLocationId) continue
          inventoryRows.push({ variantId, storeLocationId, stock: level.stock })
        }
      }

      colorFamilyKeyUpdates.push({
        productId: existingProduct.id,
        key: group.colorFamilyKey ?? null,
      })
    }

    await fillMissingCatalogProductGenders(genderCandidates)
    const colorFamilyResult = await applyErpColorFamilyKeyUpdates(colorFamilyKeyUpdates)
    const colorFamilyActions = colorFamilyResult.reconciliation.plan.actions
    const inventoryLevelCount = await replaceErpInventoryLevels(
      [...storeIdByErpId.values()],
      inventoryRows
    )

    if (unpublishedByStock > 0) {
      warnings.push(
        `${unpublishedByStock} producto(s) quedaron despublicados porque el ERP los reportó sin stock.`
      )
    }

    return {
      success: true,
      processedCount: productCount,
      productCount,
      variantCount,
      definitionCount,
      dryRun: false,
      warnings: warnings.length > 0 ? warnings : undefined,
      storeStock: {
        locations: storeIdByErpId.size,
        inventoryLevels: inventoryLevelCount,
      },
      colorFamilies: {
        created: colorFamilyActions.filter((action) => action.mode === "create").length,
        updated: colorFamilyActions.filter((action) => action.mode === "add").length,
        omitted: colorFamilyResult.reconciliation.plan.omissions.length,
      },
    }
  } catch (error) {
    const msg = sanitizeErpError(error)
    console.error("[ERP Sync Service] Error sincronizando catálogo:", msg)
    return { success: false, processedCount: 0, error: msg }
  }
}

// ─────────────────────────────────────────────
// Estado del panel de integraciones
// ─────────────────────────────────────────────

/** Registro de sincronización serializable para el cliente (fechas como ISO). */
export interface ErpSyncLogDTO {
  id: string
  provider: string
  trigger: ErpSyncTrigger
  success: boolean
  processedCount: number
  error: string | null
  durationMs: number | null
  createdAt: string
}

export interface ErpSyncStatus {
  /** ERP configurado (ERP_PROVIDER). */
  provider: string
  /** ¿El ERP respondió al healthcheck? */
  connected: boolean
  /** ¿El adaptador efectivo permite descargar el catálogo? */
  catalogSyncAvailable: boolean
  /** ¿Está habilitado el coordinador automático? */
  autoSyncEnabled: boolean
  /** Intervalo del auto-sync, en minutos. */
  autoSyncMinutes: ErpSyncInterval
  /** Próximo vencimiento reclamable, en ISO; null cuando está desactivado. */
  nextAutoSyncAt: string | null
  /** Última sincronización registrada, o null si nunca se ha corrido. */
  last: ErpSyncLogDTO | null
  /** Historial reciente (más nueva primero). */
  history: ErpSyncLogDTO[]
}

function mapErpSyncLog(log: ErpSyncLog): ErpSyncLogDTO {
  return {
    id: log.id,
    provider: log.provider,
    trigger: log.trigger,
    success: log.success,
    processedCount: log.processedCount,
    error: log.error == null ? null : sanitizeErpError(log.error),
    durationMs: log.durationMs,
    createdAt: log.createdAt.toISOString(),
  }
}

const DIAGNOSTIC_ENDPOINTS = ["connection", "catalog", "stock"] as const
const DIAGNOSTIC_STATUSES = ["healthy", "warning", "error", "unsupported"] as const
let erpDiagnosticsInProgress = false

function failedDiagnostics(detail: string, status: "error" | "unsupported"): ERPEndpointDiagnostic[] {
  return DIAGNOSTIC_ENDPOINTS.map((endpoint) => ({
    endpoint,
    status,
    httpStatus: null,
    latencyMs: 0,
    detail,
  }))
}

function invalidDiagnostic(endpoint: ERPEndpointDiagnostic["endpoint"]): ERPEndpointDiagnostic {
  return {
    endpoint,
    status: "error",
    httpStatus: null,
    latencyMs: 0,
    detail: "El adaptador ERP no entregó un resultado de diagnóstico válido para este endpoint.",
  }
}

function normalizeDiagnostics(value: unknown): ERPEndpointDiagnostic[] {
  const candidates = Array.isArray(value) ? value : []

  return DIAGNOSTIC_ENDPOINTS.map((endpoint) => {
    const matches = candidates.filter(
      (candidate) =>
        candidate != null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate as { endpoint?: unknown }).endpoint === endpoint
    )
    if (matches.length !== 1) return invalidDiagnostic(endpoint)

    const candidate = matches[0] as Record<string, unknown>
    const statusValid = DIAGNOSTIC_STATUSES.includes(
      candidate.status as (typeof DIAGNOSTIC_STATUSES)[number]
    )
    const httpStatusValid =
      candidate.httpStatus === null ||
      (Number.isInteger(candidate.httpStatus) &&
        Number(candidate.httpStatus) >= 100 &&
        Number(candidate.httpStatus) <= 599)
    const latencyValid =
      typeof candidate.latencyMs === "number" &&
      Number.isFinite(candidate.latencyMs) &&
      candidate.latencyMs >= 0
    const detailValid = typeof candidate.detail === "string" && candidate.detail.trim().length > 0

    if (!statusValid || !httpStatusValid || !latencyValid || !detailValid) {
      return invalidDiagnostic(endpoint)
    }

    return {
      endpoint,
      status: candidate.status as ERPEndpointDiagnostic["status"],
      httpStatus: candidate.httpStatus as number | null,
      latencyMs: Math.round(candidate.latencyMs as number),
      detail: sanitizeErpError(candidate.detail),
    }
  })
}

/** Ejecuta bajo demanda los probes genéricos del adaptador sin escribir datos. */
export async function runErpEndpointDiagnostics(): Promise<ERPEndpointDiagnostics> {
  if (erpDiagnosticsInProgress) {
    return {
      checkedAt: new Date().toISOString(),
      results: failedDiagnostics("Ya hay un diagnóstico ERP en curso.", "error"),
    }
  }

  erpDiagnosticsInProgress = true
  try {
    const adapter = getERPAdapter()

    if (!adapter.diagnoseEndpoints) {
      return {
        checkedAt: new Date().toISOString(),
        results: failedDiagnostics(
          "El ERP configurado no ofrece pruebas detalladas de endpoints.",
          "unsupported"
        ),
      }
    }

    try {
      const results = await adapter.diagnoseEndpoints()
      return {
        checkedAt: new Date().toISOString(),
        results: normalizeDiagnostics(results),
      }
    } catch (error) {
      return {
        checkedAt: new Date().toISOString(),
        results: failedDiagnostics(sanitizeErpError(error), "error"),
      }
    }
  } finally {
    erpDiagnosticsInProgress = false
  }
}

/**
 * Estado de la integración para el panel de admin: conexión con el ERP,
 * última sincronización e historial reciente.
 */
export async function getErpSyncStatus(): Promise<ErpSyncStatus> {
  const adapter = getERPAdapter()

  const [connected, logs, schedule] = await Promise.all([
    // No dejamos que un ERP lento/caído cuelgue la carga del panel.
    Promise.race([
      adapter.ping().catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PING_TIMEOUT_MS)),
    ]),
    findRecentErpSyncLogs(10),
    getErpSyncSchedule(),
  ])

  const history = logs.map(mapErpSyncLog)

  return {
    provider: erpProviderName(),
    connected,
    catalogSyncAvailable: supportsCatalogSync(adapter),
    autoSyncEnabled: schedule.enabled,
    autoSyncMinutes: schedule.intervalMinutes,
    nextAutoSyncAt: schedule.nextRunAt,
    last: history[0] ?? null,
    history,
  }
}
