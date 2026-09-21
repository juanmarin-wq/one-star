---
title: 'Hacer reales los roles de administrador'
type: 'bugfix'
created: '2026-09-21'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `AdminUser.role` (`SUPER_ADMIN` | `INVENTORY_OPERATOR`) existe en el modelo pero nunca se verifica: `requireAdmin()` solo comprueba `userType === "admin"` (binario), y `admin/layout.tsx:38` hardcodea `userRole="SUPER_ADMIN"` para todos. Cualquier admin creado como "Operador de Inventario" tiene hoy acceso total.

**Approach:** Propagar el rol real del `AdminUser` a la sesión (mismo mecanismo ya usado para `userType`), y usarlo para: (1) filtrar qué secciones ve `INVENTORY_OPERATOR` en el sidebar, y (2) bloquear en el servidor las acciones fuera de su alcance — nunca confiar solo en ocultar el botón en la UI.

**Alcance confirmado de `INVENTORY_OPERATOR`:** Productos, Importar productos, Categorías, Marcas, Colores, Pedidos (ver y despachar) y Dashboard. Todo lo demás (Clientes, Cupones, Tarjetas de regalo, Landing Builder, Archivos y Medios, Tiendas, Configuración, Integraciones) requiere `SUPER_ADMIN`.

## Boundaries & Constraints

**Always:** Verificar el rol en el servidor (Server Action), nunca solo en la UI — mismo criterio ya documentado en `require-admin.ts` ("las Server Actions son endpoints públicos"). Sesiones existentes sin rol migrado deben tratarse como `SUPER_ADMIN` (no bloquear por accidente a un admin ya activo).

**Never:** Tocar el login de clientes ni el modelo `User` (negocio). Cambiar los permisos ya correctos de rutas de catálogo/pedidos.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SUPER_ADMIN entra a Configuración | Sesión con `adminRole=SUPER_ADMIN` | Acceso normal | N/A |
| INVENTORY_OPERATOR entra a Configuración | Sesión con `adminRole=INVENTORY_OPERATOR` | La sección no aparece en el sidebar | N/A |
| INVENTORY_OPERATOR invoca directamente la Server Action de Configuración | Llamada directa a la acción (sin pasar por la UI) | Se rechaza igual, sin importar si el enlace estaba oculto | Error "No autorizado" |
| Sesión antigua sin `adminRole` migrado | Admin logueado antes del cambio | Se trata como SUPER_ADMIN (no se bloquea) | N/A |
| INVENTORY_OPERATOR gestiona productos/pedidos | Rutas y acciones de catálogo y pedidos | Funciona exactamente igual que hoy | N/A |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- `AuthUser` -- agregar `adminRole String?`.
- `src/lib/auth.ts` -- `additionalFields` -- agregar `adminRole` (mismo patrón que `userType`).
- `src/lib/auth-actions.ts` -- `prepareAdminSignIn`/`upsertAuthRecords` -- escribir `adminRole` desde `AdminUser.role` al iniciar sesión.
- `src/server/auth/require-admin.ts` -- agregar `requireSuperAdmin()` y `getAdminRole()`.
- `src/app/admin/layout.tsx` -- usar el rol real de la sesión en vez de `"SUPER_ADMIN"` hardcodeado.
- `src/components/admin/AdminSidebar.tsx` -- filtrar los enlaces fuera del alcance de `INVENTORY_OPERATOR`.
- Acciones a proteger con `requireSuperAdmin()`: `src/app/admin/cupones/actions.ts`, `src/app/admin/clientes/abandonados/actions.ts`, `src/app/admin/tarjetas-regalo/actions.ts`, `src/server/actions/banner.actions.ts`, `header-config.actions.ts`, `home-grid.actions.ts`, `landing.actions.ts`, `media-asset.actions.ts`, `navigation.actions.ts`, `review.actions.ts`, `site-logo.actions.ts`, `store-settings.actions.ts`, `store.actions.ts`, `top-banner.actions.ts`, `erp.actions.ts`, `abandoned-cart.actions.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Migración: agregar `adminRole` a `AuthUser` + backfill (`UPDATE ba_users` desde `AdminUser` por email) para que sesiones activas queden correctas sin esperar el próximo login.
- [ ] `src/lib/auth.ts` y `auth-actions.ts` -- exponer y poblar `adminRole` en el login de admin.
- [ ] `src/server/auth/require-admin.ts` -- `requireSuperAdmin()` (lanza `UnauthorizedError` si el rol no es `SUPER_ADMIN` o falta) y `getAdminRole()`.
- [ ] `src/app/admin/layout.tsx` -- pasar el rol real al sidebar.
- [ ] `src/components/admin/AdminSidebar.tsx` -- ocultar para `INVENTORY_OPERATOR` los grupos/enlaces fuera de su alcance.
- [ ] Agregar `await requireSuperAdmin()` a cada acción mutadora de los archivos listados en Code Map -- el candado real.
- [ ] `src/server/auth/__tests__/require-admin.test.ts` -- cubrir la matriz I/O.

**Acceptance Criteria:**
- Given un admin con rol `INVENTORY_OPERATOR`, when abre el panel, then no ve enlaces a Cupones, Clientes, Tarjetas de regalo, Configuración, Integraciones, Landing Builder, Archivos ni Tiendas.
- Given ese mismo admin, when invoca directamente (sin UI) una acción de esas secciones, then se rechaza con "No autorizado".
- Given un `SUPER_ADMIN`, when usa cualquier sección, then nada cambia respecto a hoy.

## Verification

**Commands:**
- `pnpm vitest run src/server/auth/__tests__/require-admin.test.ts` -- expected: pasa.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- En QA: crear un `AdminUser` con rol `INVENTORY_OPERATOR`, iniciar sesión, confirmar que el sidebar solo muestra su alcance y que las acciones bloqueadas rechazan.
