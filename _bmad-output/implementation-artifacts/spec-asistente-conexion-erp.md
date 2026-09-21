---
title: 'Asistente de conexión ERP con revisión de duplicados'
type: 'feature'
created: '2026-09-21'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
  - '{project-root}/REQUERIMIENTOS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hoy, conectar un ERP real exige cambiar `ERP_PROVIDER`/credenciales en el `.env` y reiniciar el servidor "a ciegas" — sin saber antes si las credenciales sirven, ni si el catálogo del ERP va a duplicar productos ya cargados a mano (mismo modelo, distinto origen). `getERPAdapter()` es intencionalmente síncrona y agnóstica (regla explícita del código: "NO modificar nada más"); no se toca esa función.

**Approach:** Pantalla en `/admin/integraciones` donde el admin escribe el proveedor y sus credenciales, y el asistente: (1) prueba la conexión (`ping`), (2) trae el catálogo del ERP y lo compara por nombre exacto (sin mayúsculas/tildes) contra los productos manuales existentes (`erpId = null`), (3) para cada coincidencia deja elegir "vincular" (evita que el próximo sync duplique ese producto) o "dejar separados", y (4) al final entrega el valor exacto para `.env` y recuerda reiniciar el contenedor. Nunca escribe `.env` ni reinicia nada por sí solo.

## Boundaries & Constraints

**Always:** Las credenciales ingresadas se usan solo en memoria para la prueba/preview de esta sesión — nunca se guardan en la base de datos. "Vincular" cambia el `slug` del producto manual al código del ERP (única forma en que el sincronizador existente lo reconozca como el mismo producto) — mostrar advertencia explícita de que esto cambia la URL pública antes de confirmar. El emparejamiento es por nombre normalizado EXACTO (sin mayúsculas/tildes) — nunca aproximado/difuso. Backfillear `erpId` en `updateCatalogProduct` cuando hoy es `null` (sin pisar uno ya existente) para que un producto vinculado y luego sincronizado deje de verse como "Manual".

**Ask First:** Ninguno pendiente — alcance ya confirmado (incluir revisión de duplicados ahora).

**Never:** Modificar `getERPAdapter()`/`erp.container.ts`. Escribir o modificar el archivo `.env`. Reiniciar el contenedor automáticamente. Persistir credenciales de ERP en la base de datos.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Credenciales inválidas | Token de Loggro incorrecto | El paso de prueba de conexión falla antes de traer catálogo | Mensaje claro, no se avanza al preview |
| Catálogo sin coincidencias | Ningún nombre del ERP coincide con productos manuales | Preview muestra "N productos nuevos, 0 posibles duplicados" | N/A |
| Coincidencia exacta de nombre | Un producto manual "Nike Pegasus 41" y un grupo ERP con el mismo nombre | Se ofrece "Vincular" o "Dejar separados" | N/A |
| Admin vincula un producto | Confirma "Vincular" | El `slug` del producto pasa a ser el código del ERP; se le avisa que la URL pública cambió | N/A |
| Producto vinculado, sincronización real posterior | El sync real (`erp-sync.service.ts`) corre después | Actualiza ese producto (lo encuentra por slug) y le completa `erpId` (antes nulo) | N/A |
| ERP no soporta `fetchCatalog` | Adaptador sin ese método | El asistente lo indica y no ofrece el paso de comparación | N/A |

</frozen-after-approval>

## Code Map

- `src/server/erp/connection-assistant.ts` (nuevo) -- `testErpConnection(provider, credentials)`, `previewErpConnection(provider, credentials)` (fetchCatalog + comparación por nombre), `linkManualProduct(productId, erpBaseSku)`. Único lugar fuera de `adapters/` que instancia un adaptador concreto directamente (con las credenciales ingresadas, sin pasar por el contenedor global).
- `src/server/repositories/product.repository.ts` -- `findManualProductNames()` -- productos con `erpId = null` para comparar.
- `src/server/repositories/erp-catalog.repository.ts` -- `updateCatalogProduct` -- aceptar y backfillear `erpId` cuando es `null`.
- `src/app/admin/integraciones/conectar-erp/actions.ts` + `page.tsx` (nuevo) -- formulario de credenciales, preview, vincular, pantalla final con el valor para `.env`.
- `src/components/admin/AdminSidebar.tsx` -- opcional: enlace desde Integraciones (no se agrega uno nuevo al sidebar, vive dentro de Integraciones).

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/repositories/product.repository.ts` -- `findManualProductNames()`.
- [ ] `src/server/repositories/erp-catalog.repository.ts` -- extender `updateCatalogProduct` con backfill condicional de `erpId`.
- [ ] `src/server/erp/connection-assistant.ts` -- probar conexión, traer catálogo, comparar nombres normalizados, vincular.
- [ ] `src/app/admin/integraciones/conectar-erp/page.tsx` + `actions.ts` -- flujo de 3 pasos (credenciales → revisión → instrucciones finales), protegido con `requireSuperAdmin()`.
- [ ] `src/server/erp/__tests__/connection-assistant.test.ts` -- cubrir la matriz I/O.

**Acceptance Criteria:**
- Given credenciales de Loggro inválidas, when se prueban, then el asistente lo informa antes de intentar traer el catálogo.
- Given un producto manual "Nike Pegasus 41" y el ERP trae un grupo con el mismo nombre exacto, when se genera el preview, then aparece como posible duplicado con la opción de vincular.
- Given que se vincula ese producto y luego corre una sincronización real, when el sync procesa ese grupo, then actualiza el producto existente (no crea uno nuevo) y le completa el `erpId`.
- Given un nombre del ERP que no coincide con nada manual, when se genera el preview, then se lista como producto nuevo, sin pedir decisión.

## Verification

**Commands:**
- `pnpm vitest run src/server/erp/__tests__/connection-assistant.test.ts` -- expected: pasa cubriendo la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- En QA, con `ERP_PROVIDER=null`: crear un producto manual, simular (con un mock/adaptador de prueba) que el ERP trae un grupo con el mismo nombre, confirmar que el preview lo marca como posible duplicado y que "Vincular" cambia el slug.
