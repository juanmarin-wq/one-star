---
title: 'Validar cupones restringidos por categoría'
type: 'bugfix'
created: '2026-09-20'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** El admin ya puede restringir un cupón a una categoría (`CouponForm.tsx` tiene el selector "Categoría aplicable" y `Coupon.categoryId` se guarda), pero `validateCouponForOrder` (`src/server/services/coupon.service.ts`) solo recibe un número (`subtotal` del carrito completo) y nunca lee `categoryId`. Un cupón "solo para Calzado" hoy descuenta sobre TODO el carrito sin importar qué se compró.

**Approach:** Cambiar `validateCouponForOrder` para que reciba los ítems del carrito con su categoría y precio real (en vez de un `subtotal` ya sumado), calcular el descuento y el mínimo de compra sobre el subtotal de **solo los ítems de la categoría del cupón** cuando `categoryId` no es null, y rechazar el cupón si el carrito no tiene ningún ítem de esa categoría. Los datos de categoría/precio siempre se resuelven en el servidor desde la base de datos — nunca se confía en lo que mande el cliente, mismo criterio de seguridad que ya usa `placeOrder`.

## Boundaries & Constraints

**Always:** Resolver `categoryId` y precio real de cada ítem desde la base de datos (nunca desde el carrito del cliente). Si `coupon.categoryId` es `null`, comportarse exactamente igual que hoy (aplica a todo el carrito). El descuento nunca supera el subtotal elegible. El mínimo de compra (`minOrderAmount`) se compara siempre contra el **subtotal de todo el carrito**, no solo contra el de la categoría — decisión de negocio confirmada: aunque el descuento sea solo para Calzado, el mínimo de compra mide el ticket completo.

**Never:** Cambiar la lógica de cupones sin categoría (`categoryId = null`). Tocar el checkout de tarjetas de regalo o el flujo de pago. Confiar en un `categoryId` o precio que venga del cliente.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cupón sin categoría | `categoryId = null` | Se comporta igual que hoy: descuento sobre todo el carrito | N/A |
| Cupón con categoría, carrito con ítems de esa categoría y otros | Cupón "Calzado", carrito con 1 zapato + 1 accesorio | El descuento se calcula solo sobre el subtotal del zapato | N/A |
| Cupón con categoría, ningún ítem del carrito es de esa categoría | Cupón "Calzado", carrito solo con accesorios | Se rechaza | Mensaje: "Este cupón solo aplica a productos de {categoría}" |
| Cupón con categoría y mínimo de compra | Cupón "Calzado", mínimo $200.000, carrito con $150.000 en calzado + $100.000 en otra categoría | El mínimo SÍ se alcanza (total del carrito $250.000); el descuento se calcula solo sobre los $150.000 de calzado | N/A |
| Vista previa en checkout vs. confirmación real del pedido | El cliente aplica el cupón antes de pagar, luego confirma el pedido | Ambos puntos (`validateCouponAction` y `placeOrder`) calculan el mismo descuento con los mismos datos resueltos en servidor | N/A |

</frozen-after-approval>

## Code Map

- `src/server/repositories/variant.repository.ts` -- `findVariantsForPricing` -- agregar `categoryId` al `select` de `product` (ya trae `basePrice`/`isOnSale`/`salePrice`).
- `src/server/services/order.service.ts` -- `PricedOrderItem`/`priceItemsFromDatabase` -- agregar `categoryId`; `placeOrder` pasa los ítems (no un `subtotal` plano) a `validateCouponForOrder`.
- `src/server/services/coupon.service.ts` -- `validateCouponForOrder(code, items: {categoryId, unitPrice, quantity}[])` -- nueva firma; calcula subtotal total y subtotal elegible por categoría.
- `src/server/actions/coupon.actions.ts` -- `validateCouponAction` -- recibe `items: {variantId, quantity}[]` en vez de `subtotal`; resuelve precio/categoría real con `findVariantsForPricing` antes de llamar al servicio.
- `src/components/checkout/OrderSummary.tsx` y `src/app/checkout/page.tsx` -- adaptar la llamada a `validateCouponAction` para mandar `variantId`+`quantity` de `useCart().items` en vez de `subtotal`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/repositories/variant.repository.ts` -- agregar `categoryId: true` al select del producto -- fuente única de la categoría real.
- [ ] `src/server/services/order.service.ts` -- extender `PricedOrderItem` con `categoryId` y actualizar `priceItemsFromDatabase` -- disponible para `placeOrder` sin queries extra.
- [ ] `src/server/services/coupon.service.ts` -- reescribir `validateCouponForOrder` para recibir ítems y filtrar por categoría -- corrige el bug central.
- [ ] `src/server/actions/coupon.actions.ts` -- cambiar `validateCouponAction` para resolver precio/categoría en servidor a partir de `variantId` -- mantiene la regla de nunca confiar en el cliente.
- [ ] `src/components/checkout/OrderSummary.tsx`, `src/app/checkout/page.tsx` -- actualizar las llamadas al nuevo contrato de `validateCouponAction`.
- [ ] `src/server/services/__tests__/coupon.service.test.ts` -- cubrir la matriz I/O completa.

**Acceptance Criteria:**
- Given un cupón restringido a "Calzado" y un carrito con productos de otra categoría únicamente, when el cliente lo aplica, then se rechaza con un mensaje que explica por qué.
- Given un cupón restringido a "Calzado" y un carrito mixto, when se aplica, then el descuento mostrado en el checkout coincide exactamente con el que se cobra al confirmar el pedido.
- Given un cupón sin categoría (`categoryId = null`), when se aplica a cualquier carrito, then el comportamiento es idéntico al actual (sin regresión).

## Verification

**Commands:**
- `pnpm vitest run src/server/services/__tests__/coupon.service.test.ts` -- expected: pasa cubriendo la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- En QA: crear un cupón restringido a una categoría, probar en el checkout con un carrito que no tiene esa categoría (debe rechazar) y con uno que sí (debe descontar solo esa parte).
