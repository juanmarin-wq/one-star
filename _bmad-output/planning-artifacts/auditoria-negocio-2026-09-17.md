# Auditoría de negocio — One Star E-Commerce

**Fecha:** 2026-09-17
**Método:** contrastar lo documentado (`REQUERIMIENTOS.md`, `docs/architecture.md`) contra el código real, dominio por dominio (catálogo/producto, checkout/pagos/pedidos, admin/autenticación, marketing/integraciones, infraestructura/despliegue). No se repiten aquí los puntos ya registrados en `_bmad-output/implementation-artifacts/deferred-work.md`; se citan solo como contexto cuando son relevantes.
**Ambiente usado para verificar:** QA local con Docker (`docker-compose.yml`), levantado y confirmado funcionando (home, seed de datos, admin). Antes de esta auditoría se creó un backup completo del repo en `/Users/juanmanuel/Developer/one-star-backup-20260917-161110`.

---

## Resumen ejecutivo

El código está mucho más avanzado de lo que la documentación (`docs/architecture.md`) admite en varios puntos (Meta Pixel/CAPI, Schema.org de producto), pero tiene **cuatro brechas críticas con impacto financiero u operativo directo** y una decena de funcionalidades prometidas al cliente que están a medias o inalcanzables desde la interfaz pública. La tabla de "Decisiones Arquitectónicas Pendientes" del propio proyecto está desactualizada y puede llevar a re-trabajar cosas que ya existen.

---

## Hallazgos — CRÍTICO (impacto financiero/operativo directo)

**1. Tarjetas de regalo: se cobran y nunca se emiten.**
El checkout promete explícitamente "la tarjeta de regalo llega por correo después del pago" (`src/app/checkout/page.tsx:509`), pero el modelo `GiftCard` nunca se lee ni se escribe en ningún servicio, y no existe plantilla de correo que genere código/saldo. **El cliente paga y no recibe nada utilizable.**

**2. ERP no bidireccional — ventas web no descuentan inventario en Loggro.**
Ya cubierto con spec: [spec-sincronizar-inventario-erp-al-confirmar-pago.md](../implementation-artifacts/spec-sincronizar-inventario-erp-al-confirmar-pago.md) (`status: draft`, pendiente de tu aprobación). `onOrderConfirmed` existe en el adaptador pero nunca se llama desde el flujo real de pago.

**3. Roles de administrador son cosméticos, no funcionales.**
`AdminUser.role` (`SUPER_ADMIN` / `INVENTORY_OPERATOR`) nunca se verifica: `src/app/admin/layout.tsx:38` hardcodea `SUPER_ADMIN` para todos. Cualquier admin creado como "operador de inventario" tiene en la práctica acceso total (cupones, configuración, tokens de Meta, clientes). Riesgo si se planea dar acceso limitado a personal operativo.

**4. Cupones restringidos por categoría no se validan.**
`Coupon.categoryId` se guarda pero `validateCouponForOrder` nunca lo consulta ni filtra el carrito por categoría — un cupón "solo para calzado" descuenta sobre todo el pedido. Tampoco hay selector en el formulario admin, así que hoy es un campo inalcanzable e inútil.

---

## Hallazgos — ALTO (funcionalidad prometida, no entregada o inconsistente)

**5. Filtro por Categoría ausente en el catálogo público**, pese a ser requisito explícito (`REQUERIMIENTOS.md §A`) y estar soportado en el backend.

**6. Guía de tallas estática e igual para todos los productos**, ignorando los datos reales por variante (`sizeUS/sizeCM/sizeEUR`) que el admin ya carga — crítico porque `REQUERIMIENTOS.md` pide específicamente equivalencias reales para Hoka.

**7. Búsqueda (`/buscar`) solo filtra por nombre**, pese a anunciar "por producto, marca o modelo".

**8. Perfil de cliente (`/cuenta`) no carga sus propios datos guardados** (teléfono, marca favorita) al recargar la página; cédula y fecha de nacimiento capturadas en el registro no se ven ni se editan nunca ahí. "Mis direcciones" es un placeholder.

**9. Carritos abandonados solo se registran, no se recuperan.** No hay cron ni email automático de recuperación — la recuperación es 100% manual desde el admin.

**10. Discrepancias de pago reales solo van a consola.** `amount_mismatch` y `late_approval` (dinero real que no calza, o aprobado sobre un pedido ya cancelado) no generan alerta a Sentry ni al admin — pueden pasar inadvertidos indefinidamente.

---

## Hallazgos — MEDIO (SEO / marketing / documentación)

**11. Bug de SEO:** el JSON-LD de producto declara `"InStock"` siempre, sin usar el stock real ya calculado en la misma función — un producto agotado sigue anunciándose disponible a Google.

**12. `BreadcrumbList` no implementado** en ninguna página (P6 sigue parcialmente pendiente).

**13. GA4: 0% implementado** (ninguna referencia a `gtag` en el código).

**14. WhatsApp Business: solo un campo de contacto**, sin integración real (P5 en 0%).

**15. La tabla "Decisiones Arquitectónicas Pendientes" de `docs/architecture.md` está desactualizada:** Meta Pixel+CAPI (funnel completo: ViewContent, AddToCart, InitiateCheckout, Purchase con dedup) y el Schema.org de producto ya están implementados, pero la tabla los sigue marcando como pendientes (P6, P7). Riesgo de re-trabajar algo que ya funciona.

---

## Hallazgos — BAJO (deuda técnica / infraestructura)

**16. CI no corre las pruebas E2E de Playwright** pese a estar configuradas (`e2e/`, 7 specs) — regresiones de checkout/login/admin solo se detectan manualmente antes de mergear a `develop`.

**17. La protección de la rama `develop` (con autodeploy) es nominal:** GitHub la marca `protected: true` pero sin checks obligatorios ni aprobación humana configurados.

**18. Vestigio inocuo:** bloque comentado de URLs de Supabase en `.env.example` (limpieza documental pendiente).

**19. Sentry se apaga en silencio** si faltan las variables DSN en producción, sin alerta de "observabilidad caída".

---

## Ya resuelto (verificado en código, no requiere acción)

- TLS de `new.tiendaonestar.com` — certificado Let's Encrypt válido.
- Vulnerabilidad Prisma/`deepmerge-ts` (GHSA-ggr8-5vv4-36mx) — resuelta, `pnpm audit` en 0.
- Versión de pnpm sin fijar — resuelto (`packageManager` fijado en `package.json`, `Dockerfile` y CI).
- Concurrencia de pago/stock en `markOrderPaidWithStock` — ya bien resuelta en código, aunque `deferred-work.md` la sigue listando como pendiente (documento desactualizado, no el código).

---

## Estado de los pendientes de despliegue del 2026-08-25 (verificación puntual)

| Pendiente | Estado |
|---|---|
| Proteger `main`/rama de despliegue antes del autodeploy | **Abierto** — protección nominal, sin checks obligatorios |
| TLS de `new.tiendaonestar.com` | **Resuelto** |
| Crear admin de producción | No verificable desde el repo (hecho operativo) |
| Webhook de ePayco configurado en su panel | No verificable desde el repo (pendiente de confirmar en el panel de ePayco) |
| Vulnerabilidad Prisma/`deepmerge-ts` | **Resuelto** |
| pnpm sin versión fijada | **Resuelto** |

---

## Recomendación de siguiente paso

Sin cambios de código todavía (como pediste). El orden sugerido para levantar el próximo spec, por impacto:

1. **Tarjetas de regalo** (crítico #1) — dinero cobrado sin entrega del bien.
2. **Aprobar o ajustar** el spec de ERP ya creado (crítico #2).
3. **Roles de administrador reales** (crítico #3) — antes de dar acceso a más personas.
4. **Validación de cupones por categoría** (crítico #4).

Dime cuál priorizas y lo llevo al mismo proceso de spec (`bmad-quick-dev`) que usamos para el ERP.
