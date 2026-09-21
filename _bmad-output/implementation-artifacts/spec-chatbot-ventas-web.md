---
title: 'Chatbot de ventas embebido en la web'
type: 'feature'
created: '2026-09-21'
status: 'done'
context:
  - '{project-root}/docs/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No existe ninguna forma de que un visitante consulte stock o arme una compra conversando — hoy solo puede navegar el catálogo a mano. El negocio quiere un chatbot con IA en la web (no WhatsApp) que ayude a vender: responder qué hay disponible y armar el carrito.

**Approach:** Un widget de chat flotante en toda la tienda pública. El bot usa el modelo de IA con *tool use* para buscar productos y consultar stock reales (nunca inventa precios/existencias — siempre consulta la base de datos), y puede agregar ítems al carrito del visitante, que luego sigue el checkout normal ya construido. Hoy no hay API key de IA: se construye todo el sistema (widget, herramientas, orquestación) y, sin la credencial, el bot responde con un mensaje de "no disponible por ahora" — mismo patrón de degradación ya usado para Resend/ePayco. Conectar la IA de verdad, cuando haya API key, es solo poner la variable de entorno.

## Boundaries & Constraints

**Always:** El precio, el stock y la existencia de un producto/variante SIEMPRE se verifican contra la base de datos en el momento — el modelo nunca decide esos valores. Agregar al carrito valida servidor-side que la variante existe y tiene stock antes de devolver la acción; el carrito en sí sigue viviendo en el cliente (Zustand/localStorage), el bot solo le indica al cliente qué agregar. Sin `ANTHROPIC_API_KEY`, el chat debe responder con un mensaje claro de no disponibilidad, nunca romper la página.

**Ask First:** Ninguno — alcance ya confirmado (arma carrito + manda al checkout normal, sin generar link de pago separado).

**Never:** Que el bot invente disponibilidad, precios o promesas de envío. Que el bot cree pedidos o toque pagos directamente — solo agrega al carrito del visitante. Guardar la conversación en una base de datos (queda en memoria del navegador de esta sesión, se pierde al recargar — explícito para no sobre-construir en esta primera versión).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sin API key configurada | `ANTHROPIC_API_KEY` vacía | El chat responde "Todavía no está disponible, vuelve pronto" | No rompe la página ni el resto del sitio |
| Cliente pregunta por un producto que existe | "¿Tienen la Nike Pegasus en talla 42?" | El bot consulta stock real y responde con disponibilidad y precio reales | N/A |
| Cliente pide agregar algo sin stock | Pide una talla agotada | El bot lo informa y no agrega nada al carrito | N/A |
| Cliente pide agregar algo válido | Talla con stock real | Se agrega al carrito del visitante y el bot ofrece ir al checkout | N/A |
| El modelo de IA falla o tarda demasiado | Error de red/timeout hacia la API de IA | El chat muestra un error amigable, no bloquea el resto de la página | Se registra el error en logs, no se reintenta automático |

</frozen-after-approval>

## Code Map

- `package.json` -- agregar `@anthropic-ai/sdk`.
- `docs/architecture.md` -- documentar `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` en Variables de Entorno.
- `src/server/services/ai-chat.service.ts` (nuevo) -- orquestación: arma el prompt, define las herramientas, corre el loop de *tool use*, ejecuta las herramientas contra `product.service.ts` real, devuelve la respuesta + acciones de carrito.
- `src/server/actions/chat.actions.ts` (nuevo) -- `sendChatMessageAction(history, message)`, público (sin `requireAdmin`), con rate limiting por IP (mismo patrón que `coupon.actions.ts`).
- `src/components/chat/ChatWidget.tsx` (nuevo) -- burbuja flotante + panel de conversación, aplica al carrito (`useCartStore`) las acciones que devuelve el bot.
- `src/components/PublicSiteFrame.tsx` -- montar `<ChatWidget />`.

## Tasks & Acceptance

**Execution:**
- [ ] `package.json` -- agregar `@anthropic-ai/sdk`.
- [ ] `src/server/services/ai-chat.service.ts` -- herramientas `buscar_productos` (reusa `getProducts`) y `consultar_stock`/`agregar_al_carrito` (validan contra la BD real); fallback claro sin `ANTHROPIC_API_KEY`.
- [ ] `src/server/actions/chat.actions.ts` -- Server Action pública con rate limiting.
- [ ] `src/components/chat/ChatWidget.tsx` -- UI de burbuja + conversación; al recibir una acción `add_to_cart` del bot, llama `useCartStore.getState().addItem(...)`.
- [ ] `src/components/PublicSiteFrame.tsx` -- montar el widget.
- [ ] `src/server/services/__tests__/ai-chat.service.test.ts` -- cubrir la matriz I/O (mockeando el cliente de Anthropic).

**Acceptance Criteria:**
- Given `ANTHROPIC_API_KEY` vacía, when un visitante abre el chat y escribe algo, then recibe el mensaje de no disponibilidad, sin errores en consola.
- Given una talla con stock real, when el bot decide agregarla, then aparece en el carrito del visitante con el precio y SKU reales de la base de datos.
- Given una talla sin stock, when el visitante la pide, then el bot no la agrega y lo explica.

## Verification

**Commands:**
- `pnpm vitest run src/server/services/__tests__/ai-chat.service.test.ts` -- expected: pasa cubriendo la matriz I/O.
- `pnpm lint` -- expected: sin errores nuevos.

**Manual checks (if no CLI):**
- En QA sin `ANTHROPIC_API_KEY`: abrir el widget, confirmar el mensaje de no disponibilidad y que el resto del sitio sigue funcionando normal.
