---
title: 'Sincronizar inventario con el ERP al confirmar el pago'
type: 'feature'
created: '2026-09-17'
status: 'draft'
context:
  - '{project-root}/docs/architecture.md'
  - '{project-root}/REQUERIMIENTOS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** La integración ERP solo funciona en un sentido: `fetchCatalog` trae precios/stock de Loggro hacia la web, pero cuando un pedido se paga en la tienda, `IERPAdapter.onOrderConfirmed` (ya implementado en `LoggroERPAdapter`, registra una salida de inventario) nunca se invoca. Hoy solo se descuenta `Variant.stock` en Postgres; Loggro no se entera de la venta web, así que la próxima sincronización de catálogo puede repetir el mismo stock ya vendido y desalinear ambos canales. `REQUERIMIENTOS.md §D` ya documenta este contrato ("al confirmar un pedido: crear factura + mover inventario", fire-and-forget) pero nunca quedó conectado al flujo real de pago.

**Approach:** En el único punto donde un pedido pasa a `PAID` por primera vez (`applyPaymentNotification`, rama `EpaycoStatus.ACCEPTED`), notificar al ERP en fire-and-forget con los ítems vendidos (SKU + cantidad) usando `erp.onOrderConfirmed`. Solo se envían las líneas cuyo `Variant.erpId` no es nulo (mismo filtro que ya usa la validación JIT de stock). Requiere exponer `sku` y `erpId` por ítem en `OrderDTO`, que hoy no los expone.

## Boundaries & Constraints

**Always:** Disparar la notificación al ERP solo en la transición real a `PAID` (dentro de la misma rama que ya llama `runPostPaymentEffects`), nunca en pagos ya aplicados, rechazados o pendientes. Filtrar por `erpId !== null` antes de construir el `ERPInvoice`; si no queda ningún ítem, omitir la llamada. Nunca bloquear ni retrasar la respuesta del webhook o de `confirmPaymentByReference` esperando al ERP. Nunca hacer fallar ni revertir el pago si el ERP responde con error — solo registrar el error (mismo patrón que `runPostPaymentEffects`). Reutilizar `getERPAdapter()` existente; no instanciar adaptadores directamente.

**Ask First:** Si además de loguear con `console.error` se debe persistir el resultado en `ErpSyncLog` (hoy solo cubre sync de catálogo, requeriría ampliar `ErpSyncTrigger`) para permitir reintentos/auditoría manual — se puede diferir.

**Never:** Implementar en este spec la facturación electrónica o `upsertCustomer` (el propio adaptador Loggro los marca como pendientes/fuera de alcance). Modificar la lógica de descuento de `Variant.stock` en Postgres (`markOrderPaidWithStock`). Cambiar la selección de adaptador (`ERP_PROVIDER`) ni el contrato `IERPAdapter`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pago aprobado con ítems ERP | Webhook ACCEPTED, pedido pasa a PAID, todos los ítems tienen `Variant.erpId` | `erp.onOrderConfirmed` se llama una vez con SKU+qty de cada ítem | N/A |
| Pago aprobado con ítems mixtos | Un ítem tiene `erpId`, otro es tarjeta regalo/manual sin `erpId` | Solo el ítem con `erpId` viaja en `ERPInvoice.items` | N/A |
| Pago aprobado sin ítems ERP | Ningún ítem tiene `erpId` | No se llama al ERP | N/A |
| Webhook duplicado | Pedido ya `paymentStatus=APPROVED` (rama `already_paid`) | No se vuelve a notificar al ERP | N/A |
| Confirmación por `ref_payco` (página de respuesta) | Mismo pedido confirmado por `confirmPaymentByReference` en vez del webhook | Mismo comportamiento: se notifica una sola vez, en la transición real | N/A |
| ERP no responde o falla | `onOrderConfirmed` rechaza la promesa o tarda | El pedido permanece PAID; el error se loguea; la respuesta al cliente/pasarela no se retrasa ni falla | Log vía `console.error`, sin reintento automático |

</frozen-after-approval>

## Code Map

- `src/server/repositories/order.repository.ts` -- `findOrderById`/`findManyOrders` deben incluir `variant` en `items` para exponer `sku` y `erpId`.
- `src/server/services/order.service.ts` -- `OrderItemDTO`/`mapToDTO` -- agregar `sku: string | null` y `erpId: string | null` por ítem.
- `src/server/services/payment.service.ts` -- `applyPaymentNotification` (rama `EpaycoStatus.ACCEPTED`) -- tras `runPostPaymentEffects(paidOrder)`, construir `ERPInvoice` y llamar `erp.onOrderConfirmed` en fire-and-forget.
- `src/server/erp/erp.types.ts` -- `ERPInvoice`/`ERPOrderItem` -- sin cambios, ya soportan el payload necesario.
- `src/server/services/__tests__/payment.service.test.ts` -- cubrir los escenarios de la matriz I/O.

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/repositories/order.repository.ts` -- incluir `variant: true` en el `include` de items de `findOrderById` y `findManyOrders` -- necesario para leer SKU/erpId sin queries adicionales.
- [ ] `src/server/services/order.service.ts` -- extender `OrderItemDTO` y `mapToDTO` con `sku`/`erpId` desde `item.variant` -- expone el dato al servicio de pagos sin romper consumidores existentes (campos nuevos, no se quita ninguno).
- [ ] `src/server/services/payment.service.ts` -- agregar función `runERPSyncEffects(order)` (mismo patrón que `runPostPaymentEffects`: fire-and-forget, catch propio) que arma el `ERPInvoice` filtrando ítems con `erpId`, la omite si el arreglo queda vacío, y la invoca junto a `runPostPaymentEffects(paidOrder)` -- cierra el ciclo bidireccional documentado en `REQUERIMIENTOS.md §D`.
- [ ] `src/server/services/__tests__/payment.service.test.ts` -- pruebas para cada fila de la matriz I/O, mockeando `getERPAdapter` -- evita regresiones en el disparo condicional.

**Acceptance Criteria:**
- Given un pedido con ítems vinculados al ERP, when el webhook de ePayco confirma el pago por primera vez, then `erp.onOrderConfirmed` se llama exactamente una vez con los SKU y cantidades correctos.
- Given que `onOrderConfirmed` falla o no responde, when se confirma el pago, then el pedido igual queda `PAID`/`APPROVED` y la respuesta HTTP del webhook no cambia.
- Given un webhook duplicado o una confirmación posterior por `ref_payco` del mismo pedido ya pagado, when se procesa, then no hay una segunda llamada al ERP.

## Design Notes

`runPostPaymentEffects` ya es el precedente exacto de este patrón (fire-and-forget con `.catch` propio para correo y Meta CAPI); `runERPSyncEffects` debe seguir la misma forma en vez de introducir un mecanismo nuevo:

```ts
function runERPSyncEffects(order: OrderDTO): void {
  const erpItems = (order.items ?? [])
    .filter((i) => i.erpId !== null)
    .map((i) => ({ sku: i.sku!, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice }))
  if (erpItems.length === 0) return
  const erp = getERPAdapter()
  erp.onOrderConfirmed({ orderId: order.id, customer: {...}, items: erpItems, total: order.total, paymentMethod: order.paymentMethod ?? "epayco" })
    .catch((error: unknown) => console.error(`[payment] ERP onOrderConfirmed falló para pedido ${order.id}:`, error))
}
```

## Verification

**Commands:**
- `pnpm vitest run src/server/services/__tests__/payment.service.test.ts` -- expected: pasa incluyendo los nuevos casos de la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.
