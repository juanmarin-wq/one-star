---
title: 'Importar catálogo desde Excel (sin ERP)'
type: 'feature'
created: '2026-09-17'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
  - '{project-root}/REQUERIMIENTOS.md'
  - '{project-root}/_bmad-output/planning-artifacts/plantillas/plantilla_carga_productos_onestar.xlsx'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hoy no existe ninguna forma de crear productos sin ERP: no hay página "Nuevo producto" en admin, y `createProductRecord` (`src/server/repositories/product.repository.ts:151`) solo lo invoca la sincronización ERP (`erp-catalog.repository.ts`). Sebas va a entregar el catálogo inicial (fotos, referencias, stock) en la plantilla Excel ya distribuida, y no hay manera de cargarlo — esto bloquea el lanzamiento del 1 de octubre si el ERP (Loggro) no está listo a tiempo.

**Approach:** Página `/admin/productos/importar`: sube el `.xlsx` de la plantilla, lo parsea, agrupa filas por producto (mismo Nombre+Marca+Categoría), valida y muestra una **vista previa** (crear / actualizar / error, fila por fila). Solo al confirmar explícitamente se escribe, en una transacción — mismo patrón preview→apply que ya usan los backfills ERP existentes (`erp-color-family-backfill.service.ts`).

## Boundaries & Constraints

**Always:** Agrupar filas por Nombre+Marca+Categoría como un mismo producto (múltiples filas = múltiples variantes). Resolver Categoría y Marca por nombre (sin distinguir mayúsculas/tildes), creándolas si no existen (`createCategory`/`createBrand`). Generar `slug` con `slugify(nombre)` y sufijo numérico si colisiona. Si el SKU ya existe en una variante de un producto **sin** `erpId`, actualizar esa variante (stock/talla/color) en vez de duplicarla. Columnas "SI"/"NO" mapean a boolean; vacío en `isOnSale`, `availableOnline`, etc. usa el default del modelo.

**Ask First:** Si además de crear/actualizar se debe permitir que el importador **desactive** (`isPublished=false`) productos existentes que ya no aparecen en un nuevo archivo — hoy el importador solo agrega/actualiza, nunca oculta ni borra nada por omisión.

**Never:** Tocar un producto o variante cuyo `erpId` no sea nulo — si el SKU de una fila pertenece a un producto gestionado por ERP, la fila se marca como error ("gestionado por ERP") y no se escribe nada sobre él. Ejecutar la escritura sin pasar antes por la vista previa. Descargar o validar en vivo que las URLs de imagen respondan (solo se valida el formato de URL, no la disponibilidad — sería demasiado lento para un import masivo).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Producto nuevo, una variante | Fila con SKU inexistente, todos los campos obligatorios completos | Vista previa: "Crear producto", al confirmar se crea Product+Variant+Images | N/A |
| Producto nuevo, varias variantes | Varias filas con mismo Nombre+Marca+Categoría, distinto SKU/talla/color | Se agrupan en un solo producto con N variantes | N/A |
| SKU repetido en el mismo archivo | Dos filas con el mismo SKU | La segunda fila se marca error "SKU duplicado en el archivo" | No se importa esa fila; el resto del archivo continúa |
| SKU existente sin ERP | SKU ya es de una variante de un producto con `erpId = null` | Vista previa: "Actualizar variante" (stock/talla/color) | N/A |
| SKU existente con ERP | SKU pertenece a un producto con `erpId` no nulo | Fila marcada error: "gestionado por ERP, no se puede modificar aquí" | No se escribe nada sobre ese producto/variante |
| Categoría o Marca nueva | El nombre no coincide (ignorando mayúsculas/tildes) con ninguna existente | Se crea automáticamente antes de crear el producto | N/A |
| Campos obligatorios vacíos | Falta SKU, Nombre, Categoría, Precio, Talla, Color o Stock | Fila marcada error con el campo faltante | No se importa esa fila |
| Archivo sin cambios tras vista previa | El admin sube el archivo, ve la previa, cierra sin confirmar | No se escribe nada en la base de datos | N/A |

</frozen-after-approval>

## Code Map

- `package.json` -- agregar dependencia `xlsx` (SheetJS) para parsear el `.xlsx` en el servidor.
- `src/server/services/product-import.service.ts` (nuevo) -- parseo, agrupamiento por producto, validación fila a fila, `previewProductImport(buffer)` y `applyProductImport(fingerprint)`.
- `src/server/repositories/product.repository.ts` -- agregar `findVariantsBySkus(skus)` (trae `erpId` del producto dueño de cada SKU) para la validación de "gestionado por ERP".
- `src/server/services/category.service.ts` / `brand.service.ts` -- reutilizar `createCategory`/`createBrand` para resolver por nombre.
- `src/app/admin/productos/importar/page.tsx` (nuevo) -- formulario de carga + tabla de vista previa (crear/actualizar/error por fila).
- `src/app/admin/productos/importar/actions.ts` (nuevo) -- Server Actions `previewProductImportAction`, `applyProductImportAction` (ambas con `requireAdmin()`).
- `src/components/admin/AdminSidebar.tsx` -- agregar enlace "Importar productos".

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- agregar `xlsx` -- necesario para leer el `.xlsx` en el servidor sin dependencias nativas.
- [ ] `src/server/repositories/product.repository.ts` -- `findVariantsBySkus(skus)` -- una sola consulta para saber qué SKUs ya existen y a qué `erpId` pertenecen.
- [ ] `src/server/services/product-import.service.ts` -- parseo (fila→objeto), agrupamiento por Nombre+Marca+Categoría, resolución de Categoría/Marca, `previewProductImport` (solo lectura, devuelve filas con su acción y un `fingerprint` del archivo) y `applyProductImport(fingerprint)` (transacción, falla si el catálogo cambió entre preview y apply, mismo criterio que `applyErpColorFamilyBackfill`) -- centraliza toda la lógica de negocio, testeable sin HTTP.
- [ ] `src/app/admin/productos/importar/actions.ts` y `page.tsx` -- sube el archivo, muestra la tabla de preview, botón "Confirmar importación" -- única forma de que un admin dispare esto.
- [ ] `src/components/admin/AdminSidebar.tsx` -- enlace nuevo bajo "Productos".
- [ ] `src/server/services/__tests__/product-import.service.test.ts` -- cubrir cada fila de la matriz I/O.

**Acceptance Criteria:**
- Given un archivo con productos nuevos y variantes de un producto existente sin ERP, when se confirma la importación, then se crean los productos nuevos y se actualizan las variantes existentes en una sola operación.
- Given una fila cuyo SKU pertenece a un producto con `erpId`, when se genera la vista previa, then esa fila aparece como error y no se escribe nada sobre ese producto al confirmar.
- Given que el catálogo cambió (otro admin editó un producto) entre la vista previa y la confirmación, when se confirma con un `fingerprint` desactualizado, then la importación falla sin escribir y pide generar una nueva vista previa.

## Verification

**Commands:**
- `pnpm vitest run src/server/services/__tests__/product-import.service.test.ts` -- expected: pasa cubriendo la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- Subir la plantilla ya distribuida (con datos reales, sin la fila de ejemplo) en `/admin/productos/importar` sobre el ambiente QA local y confirmar que los productos aparecen en `/productos`.
