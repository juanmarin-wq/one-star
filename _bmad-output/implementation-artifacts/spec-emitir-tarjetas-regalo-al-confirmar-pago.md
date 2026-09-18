---
title: 'Emitir tarjetas de regalo reales al confirmar el pago'
type: 'feature'
created: '2026-09-17'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
  - '{project-root}/src/lib/gift-card.ts'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** El checkout promete explícitamente "la tarjeta de regalo llega por correo electrónico después del pago" (`checkout/page.tsx:509`), pero el modelo `GiftCard` (código, saldo) nunca se lee ni se escribe fuera de un dato de prueba del seed. Hoy se cobra una tarjeta de regalo y el cliente no recibe ningún código: se cobra por un bien que nunca se entrega. Tampoco existe forma de que alguien en tienda verifique o use un código.

**Approach:** Al confirmarse el pago de un pedido con ítems de tarjeta de regalo (SKU `GIFT-CARD-*`), generar un código único por unidad comprada con saldo igual a la denominación, guardarlo y enviarlo por correo. Se agrega una página admin mínima para buscar un código y descontar su saldo cuando el cliente lo use — sin construir canje en línea en el checkout (eso queda fuera, es una decisión de negocio aparte).

## Boundaries & Constraints

**Always:** Generar un código por cada unidad comprada (si compra 2 tarjetas de $100.000, son 2 códigos distintos de $100.000 cada uno — una tarjeta es un regalo para una persona). Formato de código humano-legible: `OS-XXXX-XXXX-XXXX` con alfabeto sin caracteres ambiguos (sin `0/O`, `1/I/L`). Emitir solo para ítems cuyo SKU cumpla `isGiftCardSku` (`src/lib/gift-card.ts`). Enviar el correo en fire-and-forget, mismo patrón que `runPostPaymentEffects` en `payment.service.ts` — nunca bloquear ni revertir el pago si la emisión o el correo fallan. Reintentar la generación del código ante colisión de unicidad (reintento simple, la probabilidad es mínima con este alfabeto).

**Ask First:** Si se debe permitir canjear el saldo de una tarjeta como método de pago dentro del checkout de la web (hoy fuera de alcance; el canje que se construye aquí es manual, solo desde el admin).

**Never:** Modificar el flujo de pago, cupones o el checkout público. Emitir un código para un pedido que no está `PAID`/`APPROVED`. Permitir que el saldo de una tarjeta quede negativo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compra de 1 tarjeta de regalo | Pedido pagado con 1 ítem SKU `GIFT-CARD-100000`, qty 1 | Se crea 1 `GiftCard` con saldo 100.000 y se envía el correo con el código | N/A |
| Compra de varias unidades | Mismo SKU, qty 2 | Se crean 2 códigos distintos, cada uno con saldo 100.000 | N/A |
| Pedido mixto | Ítems normales + 1 tarjeta de regalo | Se emite solo el código de la tarjeta; el correo de confirmación de pedido normal no cambia | N/A |
| Pedido sin tarjetas | Ningún ítem es SKU de tarjeta | No se genera ningún `GiftCard` ni correo adicional | N/A |
| Falla el envío de correo | El proveedor de correo responde error | El código ya quedó guardado en la base; el pago no se afecta | Se registra el error, no se reintenta automáticamente |
| Admin busca un código válido con saldo | Código existente, `isActive=true`, `balance > 0` | Se muestra el saldo disponible | N/A |
| Admin canjea más saldo del disponible | Monto a descontar > saldo actual | Se rechaza la operación | Mensaje: "El monto excede el saldo disponible" |
| Admin busca un código que no existe | Código inválido/no encontrado | Mensaje "Código no encontrado" | N/A |

</frozen-after-approval>

## Code Map

- `src/server/services/order.service.ts` -- `OrderItemDTO`/`mapToDTO` -- agregar `sku: string | null` por ítem (necesario para detectar `isGiftCardSku` desde `OrderDTO`; también lo necesitará el spec de sincronización ERP).
- `src/server/repositories/gift-card.repository.ts` (nuevo) -- `createGiftCardRecord`, `findGiftCardByCode`, `findManyGiftCards` (búsqueda por código), `redeemGiftCardAmount` (decremento condicional `balance >= amount`, atómico).
- `src/lib/gift-card-code.ts` (nuevo) -- `generateGiftCardCode()`, alfabeto sin ambiguos.
- `src/server/services/gift-card.service.ts` (nuevo) -- `issueGiftCardsForOrder(order)`, `searchGiftCard(code)`, `redeemGiftCard(code, amount)`.
- `src/server/email/templates.ts` -- `giftCardDeliveryEmail(params)` -- nueva plantilla con los códigos y saldos.
- `src/server/services/email.service.ts` -- `sendGiftCardEmail(params)` -- envuelve la plantilla nueva con `sendEmail`.
- `src/server/services/payment.service.ts` -- `applyPaymentNotification` (rama `EpaycoStatus.ACCEPTED`) -- junto a `runPostPaymentEffects(paidOrder)`, llamar `issueGiftCardsForOrder(paidOrder)` en fire-and-forget.
- `src/app/admin/tarjetas-regalo/page.tsx` + `actions.ts` (nuevo) -- buscar por código, ver saldo, canjear un monto.
- `src/components/admin/AdminSidebar.tsx` -- enlace nuevo.

## Tasks & Acceptance

**Execution:**
- [ ] `src/server/services/order.service.ts` -- agregar `sku` a `OrderItemDTO`/`mapToDTO` -- sin esto no se puede detectar qué ítem es tarjeta de regalo desde `OrderDTO`.
- [ ] `src/lib/gift-card-code.ts` -- generador de código con el formato `OS-XXXX-XXXX-XXXX`.
- [ ] `src/server/repositories/gift-card.repository.ts` -- CRUD mínimo + `redeemGiftCardAmount` con `updateMany` condicional (mismo patrón que `markOrderPaidWithStock`) para no dejar saldo negativo bajo concurrencia.
- [ ] `src/server/services/gift-card.service.ts` -- `issueGiftCardsForOrder` (una `GiftCard` por unidad, reintento en colisión de código), `searchGiftCard`, `redeemGiftCard`.
- [ ] `src/server/email/templates.ts` y `email.service.ts` -- `giftCardDeliveryEmail`/`sendGiftCardEmail`.
- [ ] `src/server/services/payment.service.ts` -- disparar `issueGiftCardsForOrder(paidOrder).then(sendGiftCardEmail...).catch(...)` junto a `runPostPaymentEffects`.
- [ ] `src/app/admin/tarjetas-regalo/page.tsx` + `actions.ts` -- búsqueda y canje, con `requireAdmin()`.
- [ ] `src/components/admin/AdminSidebar.tsx` -- enlace "Tarjetas de regalo".
- [ ] `src/server/services/__tests__/gift-card.service.test.ts` -- cubrir la matriz I/O.

**Acceptance Criteria:**
- Given un pedido pagado con 2 unidades de tarjeta de regalo de $100.000, when se confirma el pago, then se crean 2 códigos distintos con saldo 100.000 cada uno y el cliente recibe un correo con ambos.
- Given que el envío del correo falla, when se confirma el pago, then el pedido sigue `PAID` y el error solo queda registrado en logs.
- Given un código con saldo 50.000, when el admin intenta canjear 80.000, then la operación se rechaza y el saldo no cambia.

## Verification

**Commands:**
- `pnpm vitest run src/server/services/__tests__/gift-card.service.test.ts` -- expected: pasa cubriendo la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- Comprar una tarjeta de regalo en el ambiente QA local, confirmar el pago y verificar en `/admin/tarjetas-regalo` que el código quedó creado con el saldo correcto.
