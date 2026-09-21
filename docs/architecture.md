# Arquitectura — One Star E-Commerce

> **Regla para agentes:** Leer este documento ANTES de tocar cualquier archivo de código.
> Refleja decisiones ya tomadas. No proponer cambios de stack sin actualizar este doc.

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework web | Next.js | 16.2.6 |
| UI Runtime | React | 19.2.4 |
| Lenguaje | TypeScript | 5.x |
| ORM | Prisma | 6.x |
| Base de datos | PostgreSQL | 15+ |
| Autenticación | better-auth | 1.x |
| Estilos | Tailwind CSS | v4 |
| Estado cliente | Zustand | 5.x |
| Validación | Zod | 4.x |
| Tablas admin | TanStack Table | 8.x |
| Animaciones | Motion (framer-motion) | 12.x |
| Gráficas admin | Chart.js + react-chartjs-2 | 4.x |
| Fechas | date-fns | 4.x |
| DnD banners | @atlaskit/pragmatic-drag-and-drop | 1.x |
| Hotkeys admin | hotkeys-js | 4.x |
| Tipografía | Barlow + Montserrat (fontsource) | 5.x |
| Package manager | pnpm | 10.34.5 |
| Containerización | Docker + docker-compose | — |

## Estructura de Carpetas

```
src/
├── app/                          # Next.js App Router
│   ├── (shop)/                   # Grupo de rutas de la tienda pública
│   │   └── layout.tsx            # Layout con Header fijo
│   ├── admin/                    # Panel de administración
│   │   ├── banners/
│   │   ├── clientes/
│   │   │   └── abandonados/
│   │   ├── configuracion/
│   │   ├── cupones/
│   │   ├── pedidos/
│   │   │   └── [id]/
│   │   └── productos/
│   │       ├── [id]/
│   │       └── nuevo/
│   ├── api/                      # Route Handlers
│   │   ├── auth/[...all]/        # better-auth catch-all
│   │   ├── products/
│   │   └── cuenta/pedidos/
│   ├── checkout/
│   │   └── success/
│   ├── cuenta/                   # Perfil del cliente
│   ├── login/
│   ├── registro/
│   ├── productos/[slug]/         # Ficha de producto
│   ├── hombre/ mujer/ ninos/ accesorios/ sale/ lanzamientos/
│   └── carrito/
├── components/
│   ├── cart/                     # CartDrawer
│   ├── checkout/                 # CheckoutStepper, OrderSummary
│   ├── home/                     # HeroBanner, CategoryGrid, FeaturedProducts, …
│   ├── shop/                     # FilterSidebar, ProductGrid, SortBar, …
│   └── ui/                       # ToastContainer y componentes base
├── context/                      # CartContext (React context)
├── hooks/                        # useToast, useAdminHotkeys
├── lib/                          # auth.ts, auth-client.ts, auth-actions.ts, utils.ts, …
├── server/
│   ├── db/prisma.ts              # Singleton de Prisma Client
│   ├── erp/                      # Capa de integración ERP (agnóstica)
│   │   ├── ports/
│   │   │   └── erp.port.ts       # Interfaz IERPAdapter — el único contrato
│   │   ├── adapters/
│   │   │   ├── null.adapter.ts   # Adaptador nulo (dev/test/modo degradado)
│   │   │   ├── alegra.client.ts  # Cliente HTTP de la API de Alegra
│   │   │   └── alegra.adapter.ts # Implementación para Alegra
│   │   ├── erp.container.ts      # Selecciona el adaptador según ERP_PROVIDER
│   │   ├── erp.types.ts          # Tipos compartidos (ERPInvoice, ERPCustomer, …)
│   │   └── index.ts              # Barrel export — punto de entrada único
│   ├── repositories/             # Capa de acceso a datos (patrón Repository)
│   │   ├── admin.repository.ts
│   │   ├── banner.repository.ts
│   │   ├── cart.repository.ts
│   │   ├── category.repository.ts
│   │   ├── coupon.repository.ts
│   │   ├── dashboard.repository.ts
│   │   ├── order.repository.ts
│   │   ├── product.repository.ts
│   │   ├── user.repository.ts
│   │   └── variant.repository.ts
│   ├── services/                 # Lógica de negocio
│   │   ├── admin.service.ts
│   │   ├── banner.service.ts
│   │   ├── cart.service.ts
│   │   ├── category.service.ts
│   │   ├── coupon.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── order.service.ts
│   │   ├── product.service.ts
│   │   ├── user.service.ts
│   │   └── variant.service.ts
│   └── validators/               # Esquemas Zod
│       ├── product.validator.ts
│       └── user.validator.ts
├── store/
│   ├── index.ts                  # Barrel de stores Zustand
│   └── cart.store.ts             # Estado global del carrito
└── types/
    ├── shop.ts
    ├── admin.ts
    └── auth.d.ts
```

## Modelo de Datos (Prisma / PostgreSQL)

### Catálogo
- **Category** → slug único, relación 1:N con Product
- **Product** → precio base, precio de oferta, género (enum), marca, slug, SEO meta, descripción extendida, videoUrl, publicación y disponibilidad por canal; relaciones con ProductImage, Variant, CartItem, OrderItem y cross-sells (M:M auto-relación)
- **ProductImage** → url, alt, position, `color` (nullable), cascade delete
- **Variant** → SKU único, talla (US/CM/EUR), color, stock
- **ProductColorFamily** → agrupación local opcional de varios `Product` que son el mismo modelo en colores distintos

#### Familias de productos por color

Loggro conserva cada color como un producto independiente. `Product.colorFamilyId` permite
relacionar esos registros solo dentro de One Star mediante `ProductColorFamily`, sin mover
variantes ni mezclar SKU, precios, inventario o imágenes. `Product.erpColorFamilyKey` guarda una
clave opaca y namespaced que entrega `IERPAdapter`; el core nunca interpreta códigos Loggro.
`ProductColorFamily.erpColorFamilyKey` solo se completa en familias automáticas, mientras que
`null` identifica familias manuales y les da precedencia.

La sincronización reconcilia una familia únicamente cuando el producto es nuevo o cambia su
clave ERP. Por eso retirar manualmente un producto no se revierte en ejecuciones posteriores con
la misma clave. Cualquier edición explícita convierte la familia en manual; el reconciliador no
la fusiona, completa ni elimina. La operación usa transacción y advisory lock, exige al menos dos
productos con colores reales distintos y nunca modifica variantes, stock, precios, SKU o fotos.

El backfill histórico es independiente de `ERP_CATALOG_WRITES_ENABLED`: primero se ejecuta
`previewErpColorFamilyBackfill()`, se revisan conteos/omisiones y luego se pasa exactamente su
`fingerprint` a `applyErpColorFamilyBackfill(fingerprint)`. Si el catálogo cambió entre ambas
fases, el apply falla sin escribir y obliga a generar otro preview.

El catálogo colapsa los miembros encontrados de una familia en una sola tarjeta después de
aplicar filtros y antes de paginar. Sus miniaturas llevan al `slug` del producto/color real.
La ficha usa la misma relación para navegar entre colores, de modo que tallas, stock y carrito
siempre corresponden únicamente al producto seleccionado.

#### Imágenes por color de variante

`ProductImage.color` vincula cada foto con un color de `Variant.color` (string libre, el mismo
que sincroniza el ERP). `null` significa "imagen general del producto".

En la ficha (`ProductDetail`), al seleccionar un color la galería muestra **las fotos de ese
color más las generales**. Si el color no tiene fotos propias, se muestra la galería completa
en lugar de dejarla vacía. La lógica vive en `src/lib/product-image.ts` (`filterImagesByColor`),
que compara colores ignorando mayúsculas y acentos.

`ProductDetail` es el componente cliente que une `ProductGallery` y `ProductInfo` porque ambos
comparten el color seleccionado; la página `productos/[slug]` sigue siendo Server Component.

#### Imagen predeterminada

`public/placeholder-product.svg` se usa cuando un producto no tiene fotos cargadas.
Se referencia siempre por la constante `PLACEHOLDER_IMAGE_URL` de `src/lib/product-image.ts`
(nunca hardcodear la ruta). Aplica en ficha, galería, tarjetas, carrito, checkout, historial de
pedidos y panel admin.

#### Publicación y disponibilidad por canal

`Product.isPublished` controla si el producto pertenece al catálogo público. Un producto no
publicado no aparece en grids, filtros, búsqueda pública, carruseles, relacionados, API ni ficha
directa, y tampoco puede agregarse a un pedido. El administrador conserva acceso completo y puede
volver a publicarlo.

`availableOnline` y `availableInStores` tienen una semántica distinta: describen en qué canal se
puede comprar un producto publicado. Por ejemplo, `isPublished=true` con `availableOnline=false`
y `availableInStores=true` sigue mostrando la ficha como “solo disponible en tiendas físicas”.
El checkout exige simultáneamente `isPublished=true` y `availableOnline=true`.

El adaptador ERP puede sugerir que un artículo nuevo nazca no publicado. La sincronización
recurrente nunca cambia `isPublished` en productos existentes. Los históricos se corrigen con un
backfill explícito cuya huella incluye `erpId`, nombre, razón y `updatedAt`; la escritura repite
esas condiciones para no sobrescribir una edición administrativa concurrente.

### Usuarios (dual-model)
- **User** (negocio): email, passwordHash, role, datos de perfil completos (cédula, teléfono, fecha nacimiento, marca preferida, género)
- **AuthUser / AuthSession / AuthAccount / AuthVerification** (better-auth): prefijo `Auth*`, mapeados a tablas `ba_*`. Se usa `prismaAdapter` apuntando a estos modelos.
- **AdminUser**: email, passwordHash, AdminRole (SUPER_ADMIN | INVENTORY_OPERATOR)

### Carrito y Pedidos
- **Cart** → 1:1 con User, items con Variant y Product
- **CartItem** → quantity, variant, product
- **Order** → estado logístico (enum `OrderStatus`: PENDING → PAID → SHIPPED → DELIVERED / CANCELLED), estado del pago (enum `PaymentStatus`: PENDING, APPROVED, REJECTED, FAILED, EXPIRED), `paidAt`, `paymentReference` (ref_payco), total, shipping (Json con dirección, método, costo y cupón), items. **Solo cuenta como venta cuando `paymentStatus = APPROVED`**: el pedido se crea PENDING al entrar al checkout de ePayco y pasa a PAID únicamente cuando la pasarela confirma (webhook `x_id_invoice` o consulta por `ref_payco` desde la página de respuesta). Los que nunca reciben notificación vencen pasadas 24 h vía `/api/cron/expire-orders` (`EXPIRED`; el cron es diario, así que en la práctica cierran entre 24 y 48 h); el correo de confirmación y el `Purchase` de Meta se disparan solo al aprobar el pago.
- **OrderItem** → snapshot de precio, quantity, variante
- **AbandonedCart** → email, cartData (Json), userId opcional, recoveredAt

### Banners y Cupones
- **Banner** → url, imageUrl, position, isActive, fechas
- **Coupon** → code único, PERCENTAGE | FIXED_AMOUNT, validaciones de fecha y uso

### Programación ERP
- **ErpSyncConfig** → singleton persistente (`id=default`) con activación, intervalo permitido y próximo vencimiento.
- El repositorio reclama un vencimiento con un `UPDATE ... WHERE nextRunAt <= now RETURNING` y adelanta `nextRunAt` antes de consultar el ERP. Así dos procesos no ejecutan el mismo vencimiento y no se mantiene una transacción durante llamadas HTTP.
- Desactivar el automático pone `nextRunAt=null`; la sincronización manual permanece independiente.
- La programación solo puede activarse cuando el `IERPAdapter` efectivo implementa `fetchCatalog`. Si una configuración heredada permanece activa con un adaptador incompatible —incluido el fallback nulo por credenciales ausentes— el scheduler la reconcilia a `enabled=false` y `nextRunAt=null` antes de reclamar el vencimiento. La operación compara el `updatedAt` observado y modifica únicamente esos dos campos: preserva el intervalo y no pisa una edición concurrente posterior; también limpia vencimientos residuales de configuraciones ya inactivas. Esos ticks se omiten con `catalog_sync_unavailable`, sin consultar el ERP ni generar fallos repetitivos.

### Configuración global
- **StoreSettings** → registro único (`id = "default"`): nombre, email y WhatsApp de contacto (Configuración); `metaPixelId`, `metaPixelEnabled`, `metaTestEventCode` y `metaAccessToken` (solo servidor) para Meta Pixel + API de Conversiones (Integraciones → Marketing)

## Decisiones Arquitectónicas Tomadas

| # | Decisión | Justificación |
|---|---|---|
| 1 | **Patrón Repository + Service** en `src/server/` | Desacopla acceso a datos de la lógica de negocio; facilita tests unitarios mockeando el repositorio |
| 2 | **better-auth con modelos `Auth*` separados** | Evita colisión con el modelo `User` de negocio; permite tener campos de perfil propios sin hackear el esquema de la lib |
| 3 | **Tailwind v4** (PostCSS plugin) | API CSS-first, sin config JS; tokens definidos en CSS custom properties |
| 4 | **App Router de Next.js** con Server Actions | Reduce el boilerplate de API Routes para mutaciones; SSR nativo para catálogo y SEO |
| 5 | **Zustand** para estado del carrito en cliente | Más ligero que Redux; persistencia local con `persist` middleware |
| 6 | **Docker Compose** con servicio Postgres | Entorno local reproducible; mismo Dockerfile para staging/prod |
| 7 | **`server-only`** en módulos de servidor | Previene importar código de servidor en componentes de cliente en build time |
| 8 | **Capa ERP agnóstica (Ports & Adapters)** en `src/server/erp/` | La tienda NO depende de ningún ERP específico. Cambiar de Alegra a otro ERP = solo cambiar `ERP_PROVIDER` en `.env` y crear un adaptador. El core nunca se modifica. Ver `REQUERIMIENTOS.md §D` |
| 9 | **CSP dinámica con nonce por request** | Bloquea scripts no autorizados sin romper Next.js, ePayco, Sentry, mapas ni el preview administrativo |

### Content Security Policy

`src/proxy.ts` genera un nonce criptográfico distinto para cada request HTML,
lo reenvía como `x-nonce` al render de Next.js y adjunta la misma política a la
respuesta, incluidos los redirects de autenticación. El layout raíz es dinámico
y distribuye el nonce a `next-themes`, al script de checkout de ePayco y al
JSON-LD de producto.

En producción, `script-src` usa nonce y `strict-dynamic`, sin
`'unsafe-inline'` ni `'unsafe-eval'`. Solo desarrollo incorpora
`'unsafe-eval'`, `ws:` y `wss:` para source maps y recarga en caliente.
`style-src 'unsafe-inline'` se conserva porque Motion, Leaflet, `next-themes` y
el constructor visual generan estilos en runtime; esta excepción no habilita
JavaScript inline.

La política permite conexiones únicamente a ePayco, los endpoints de ingestión
de Sentry y Nominatim. Los frames y formularios externos se restringen a
ePayco. Imágenes y medios admiten HTTPS para Cloudinary, los tiles de OpenStreetMap y los recursos
administrables. `object-src 'none'`, `base-uri 'self'` y
`frame-ancestors 'none'` permanecen cerrados; solo `/?preview=true` admite
`frame-ancestors 'self'` para el iframe interno del panel.

Agregar un proveedor de scripts, tracking, conexiones o frames exige actualizar
el inventario en `src/lib/content-security-policy.ts`, sus pruebas y esta
sección. No se deben usar comodines globales ni nonces fijos.

## Decisiones Arquitectónicas Pendientes

| # | Área | Opciones |
|---|---|---|
| P1 | **Pasarela de pago** | ePayco vs MercadoPago — ambas mencionadas; definir SDK y webhook |
| P2 | **Carga de imágenes** | ✅ Cloudinary — `POST /api/upload` acepta multipart y retorna `secure_url` |
| P3 | **Email transaccional** | Resend vs SendGrid vs SMTP propio para confirmaciones de pedido |
| P4 | **ERP concreto a conectar** | Arquitectura agnóstica ya construida. Definir qué ERP usar y activar su adaptador |
| P5 | **WhatsApp Business** | Cloud API Meta vs Twilio; trigger en nuevo pedido |
| P6 | **Schema.org / SEO estructurado** | Implementar `Product` schema en ficha; `BreadcrumbList` en categorías |
| P7 | **Tracking** | Meta Conversions API + GA4; configurar eventos de conversión post-checkout |

## Patrones de Datos

### Server Actions (Next.js)
Las mutaciones se implementan como Server Actions en archivos `actions.ts` dentro de cada ruta de la app. El flujo es:
```
Client Component → Server Action → Service → Repository → Prisma → PostgreSQL
```

### API Routes
Se usan para endpoints que necesitan acceso desde el cliente sin full-page navigation (e.g., `/api/products`, `/api/cuenta/pedidos`).

### Validación
Zod valida en la capa de `validators/` antes de llamar servicios. Los errores se devuelven tipados.

## Stock por sede (informativo)

El ERP entrega las existencias por establecimiento y la web las publica en dos niveles:

| Dato | Dónde vive | Quién lo escribe | Para qué sirve |
|---|---|---|---|
| Total vendible por variante | `Variant.stock` | Sincronización ERP; se descuenta al pagar | Catálogo, filtros, selector de tallas, validación del checkout |
| Desglose por sede | `InventoryLevel` (`variantId` × `storeLocationId`) | Sincronización ERP para sedes con `StoreLocation.erpId`; el admin para sedes sin vínculo | Ficha de producto ("Fundadores: 2 · Centro: 1") y formulario administrativo |

Reglas:

- `StoreLocation.erpId` (único) vincula una tienda física con el establecimiento del ERP. La
  sincronización garantiza una sede por establecimiento: reutiliza la vinculada, enlaza por nombre
  una sede sin vínculo (`normalizeStoreName`) o la crea **oculta** con dirección/ciudad `Por definir`
  para que el administrador la complete en `/admin/tiendas` antes de publicarla.
- El desglose es **solo informativo**: la web no reserva ni aparta unidades de tienda y no ofrece
  recogida en sede. El cliente ve dónde hay existencias para comprarlas presencialmente.
- Al pagar un pedido se descuenta `Variant.stock` y, en la misma transacción, el desglose de las
  sedes con más existencias; la siguiente sincronización vuelve a alinear ambos con el ERP.
- El formulario de producto solo permite editar el stock de sedes sin vínculo ERP y solo reemplaza
  las filas de las sedes que envía, para no borrar el desglose sincronizado.
- La capa ERP expone el desglose de forma agnóstica: `ERPCatalogSnapshot.locations`,
  `ERPCatalogVariant.stockByLocation` y `IERPAdapter.listStockLocations?()`. Un ERP que no
  distinga sedes simplemente no los informa y la tienda sigue funcionando con el total.

## Variables de Entorno Requeridas

> Inventario completo y comentado: **`.env.example`** (versionado).
> Procedimiento de despliegue: **`docs/deploy-docker.md`**.

```bash
# Base de datos
POSTGRES_USER=...                 # Inicializa el contenedor PostgreSQL de producción
POSTGRES_PASSWORD=...             # Solo en el entorno del servidor; nunca versionar
POSTGRES_DB=...                   # Base creada por el contenedor PostgreSQL
DATABASE_URL=postgresql://...     # Conexión de runtime
DIRECT_URL=postgresql://...       # Conexión directa para migraciones de Prisma
DATABASE_STARTUP_MAX_ATTEMPTS=12  # Intentos de conexión del entrypoint Docker antes de abortar
DATABASE_STARTUP_RETRY_SECONDS=5  # Segundos entre sondeos de conexión del entrypoint
DATABASE_STARTUP_PROBE_TIMEOUT_SECONDS=5 # Timeout de cada sondeo; rango permitido 1..60
# En el despliegue Docker ambas apuntan al mismo Postgres. Si algún día se usa un
# pooler externo NO son intercambiables: DATABASE_URL debe ir al pooler (modo
# transaction) con ?pgbouncer=true, y DIRECT_URL a la conexión directa, porque
# `prisma migrate` necesita una sesión persistente para los advisory locks y el
# DDL transaccional.

# Autenticación (better-auth)
AUTH_SECRET=...                   # Secret para firmar sesiones
BETTER_AUTH_SECRET=...            # Alias soportado por auth.ts
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Integración ERP (agnóstica — ver src/server/erp/)
ERP_PROVIDER="null"               # "null" | "alegra" | "siigo" | "loggro" | (futuro)
ALEGRA_EMAIL=""                   # Email de la cuenta Alegra
ALEGRA_API_KEY=""                 # API Key de Alegra
LOGGRO_API_TOKEN=""               # Token Bearer de conexión para Loggro Pymes
LOGGRO_BASE_URL=""                # Base URL para Loggro Pymes (default: https://api.loggro.com)
LOGGRO_ESTABLECIMIENTO_UUID=""    # (opcional) UUID del establecimiento para consultar existencias
LOGGRO_BODEGA_UUID=""             # (opcional) UUID de la bodega; si se omiten, se auto-detectan
LOGGRO_STOCK_SCOPE="all"          # "all" suma el stock de todas las tiendas | "primary" solo la sede principal
LOGGRO_IVA_RATE="0.19"            # Tasa de IVA de RESPALDO: solo aplica a ítems sin `ivaVenta` válido (ver nota abajo)
ERP_CATALOG_WRITES_ENABLED="false" # Fail-closed: habilitar solo tras validar dry-run y reparar duplicados
DISABLE_INTERNAL_CRON=""          # "1" apaga los cron internos; usar solo con disparador externo
CRON_SECRET=""                    # (opcional) Protege /api/cron/sync-erp para disparadores externos

# Correos transaccionales (Resend — ver src/server/email/)
RESEND_API_KEY=""                 # API key de Resend (https://resend.com/api-keys)
EMAIL_FROM="One Star <onboarding@resend.dev>"  # Remitente. En producción usa un dominio verificado en Resend
# Para Siigo u otro ERP, documentar sus variables aquí al agregar el adaptador

# Sentry (observabilidad — opcionales en desarrollo, requeridas en producción)
SENTRY_DSN=https://...@o0.ingest.sentry.io/...   # DSN del proyecto Sentry (server)
NEXT_PUBLIC_SENTRY_DSN=https://...               # DSN público (client bundle)
SENTRY_ORG=one-star                              # Slug de la organización en Sentry
SENTRY_PROJECT=one-star-web                      # Slug del proyecto en Sentry
SENTRY_AUTH_TOKEN=...                            # Token para subir source maps en CI

# ePayco (pasarela de pagos — integrada)
NEXT_PUBLIC_EPAYCO_PUBLIC_KEY=...   # Llave pública del dashboard de ePayco
EPAYCO_PRIVATE_KEY=...              # Llave privada (solo servidor) para firmar webhook
EPAYCO_CUSTOMER_ID=...              # ID del cliente en ePayco (p_cust_id_cliente)
NEXT_PUBLIC_EPAYCO_TEST=true        # "true" en staging, "false" en producción

# Cloudinary (carga de imágenes de productos — ver src/app/api/upload/route.ts)
CLOUDINARY_CLOUD_NAME=...        # Nombre del cloud (Dashboard > Settings)
CLOUDINARY_API_KEY=...           # API Key
CLOUDINARY_API_SECRET=...        # API Secret (solo servidor)

# Chatbot de ventas (ver src/server/services/ai-chat.service.ts)
ANTHROPIC_API_KEY=...            # Sin esto, el chat responde "no disponible" en vez de romper la página
ANTHROPIC_MODEL=claude-sonnet-5  # Opcional; ya es el default
```

**Nota sobre el IVA de Loggro (`LOGGRO_IVA_RATE`).** Loggro entrega el precio
de venta SIN IVA y el contrato del core (`basePrice`) es el precio final que
paga el cliente, así que el adaptador suma el IVA al normalizar el catálogo
(`src/server/erp/adapters/loggro-pricing.ts` y `loggro-catalog.normalizer.ts`).
La tasa se resuelve por ítem, en este orden:

1. `ivaVenta` del ítem vendible (porcentaje, ej. `"19.00"`, `"5.00"`, `"0"`).
2. `ivaVenta` de la definición padre (`definicion: true`) a la que pertenece.
3. `LOGGRO_IVA_RATE` (default `0.19`), solo cuando ninguno de los anteriores
   viene o es válido.

Reglas de validez: se acepta string o número, con punto o coma decimal; los
valores `>= 1` se leen como porcentaje y los menores como fracción; negativos,
no numéricos o `>= 100 %` se descartan y se cae al siguiente nivel. `"0"` es
válido e identifica un ítem exento: se publica a precio neto aunque la tasa
global sea 19 %. En consecuencia, `LOGGRO_IVA_RATE=0` ya NO desactiva el IVA
para ítems que traen `ivaVenta`; solo afecta a los que no lo traen. El precio
siempre se redondea al peso más cercano.

Variables pendientes de definir:
- `MERCADOPAGO_ACCESS_TOKEN`
- `RESEND_API_KEY` (o equivalente de email)
- `GA4_MEASUREMENT_ID`

Meta Pixel y API de Conversiones **no usan variables de entorno**: el ID del
píxel, el token de la API de Conversiones y el código de evento de prueba se
administran desde `/admin/integraciones` (sección Marketing) y viven en la
tabla `StoreSettings`. El token nunca se envía al navegador; solo lo lee
`src/server/services/meta-conversions.service.ts`, que dispara el `Purchase`
server-side desde el webhook de ePayco con `event_id` = id del pedido para que
Meta lo deduplique contra el `Purchase` del píxel. `BETTER_AUTH_URL` se reutiliza
como base de `event_source_url`.

## Despliegue

El despliegue es un contenedor Docker construido con `output: "standalone"`,
junto a un PostgreSQL propio. El proceso Node queda vivo entre peticiones, así
que las tareas programadas viven dentro de la aplicación.

| | Configuración actual |
|---|---|
| Dónde | contenedor Docker (local, VPS, Lightsail) |
| Postgres | contenedor `db` |
| Sync ERP | `node-cron` despierta cada minuto; PostgreSQL decide el vencimiento |
| Vencimiento de pedidos | `node-cron` a las 07:30 |

**Programación del cron.** `node-cron` requiere un proceso vivo entre
ejecuciones, y el contenedor lo tiene. `instrumentation-node.ts` programa las
dos tareas al arrancar.

Los endpoints `GET /api/cron/sync-erp` y `GET /api/cron/expire-orders` siguen
existiendo para un disparador externo (crontab, EventBridge) con
`Authorization: Bearer $CRON_SECRET`. Si se usa uno, hay que apagar el cron
interno con `DISABLE_INTERNAL_CRON=1` para no ejecutar la tarea dos veces; con
un disparador externo, la frecuencia efectiva nunca supera su propia cadencia,
por más que el administrador configure un intervalo menor.

`erp-sync-scheduler.service.ts` usa `ErpSyncConfig` como fuente de verdad.
`instrumentation-node.ts` y `/api/cron/sync-erp` solo despiertan el coordinador;
no contienen una frecuencia de negocio fija.

`CRON_SECRET` es *fail-closed*: en producción, sin ella el endpoint responde
`503` en vez de ejecutar la sincronización sin autenticar.

Procedimiento paso a paso: **`docs/deploy-docker.md`**.

En servidor propio, el entrypoint del `runner` sondea PostgreSQL con reintentos
acotados y ejecuta `prisma migrate deploy` antes de `node server.js`; nunca
ejecuta seed. Por defecto intenta 12 veces, limita cada sondeo a 5 segundos y
pausa 5 segundos entre fallos. Los límites se configuran con las variables
`DATABASE_STARTUP_*` documentadas arriba. Cada ejecución del entrypoint tiene un
límite finito; `restart: unless-stopped` inicia un ciclo nuevo tras una salida
fallida y recupera la tienda cuando Docker o el VPS reinician. Un fallo de
conexión o migración impide iniciar la aplicación en ese ciclo. Los comandos
operativos explícitos omiten esta preparación. El CLI aislado y fijado del
`runner` usa el manifest y lock exclusivos de `docker/prisma-cli/`; para
actualizarlo se cambia la versión exacta y se regenera `package-lock.json` con
npm 10.8.2 dentro de `node:20-alpine`. El runner usa `npm ci`, por lo que
cualquier drift hace fallar el build. El lock fija versiones, tarballs e
integridades npm, pero no vuelve byte-idéntica la imagen completa: la base
Alpine, APK y la arquitectura todavía varían. Ningún servicio publica puertos:
el reverse proxy se conecta a `onestar_frontend` y PostgreSQL queda aislado en
`onestar_backend`. Las variables `NEXT_PUBLIC_*` se entregan como argumentos de
build y requieren reconstruir la imagen cuando cambian.

### Invariante de migraciones: expand/contract

Las migraciones aplicadas son inmutables y *forward-only*. CI compara únicamente
los `prisma/migrations/*/migration.sql` cambiados contra el SHA base real del
evento: una migración histórica modificada, eliminada o renombrada falla; una
migración nueva con DDL destructivo también falla. Las expansiones deben permitir
que la versión anterior y la nueva convivan: las columnas nuevas son nullable o
tienen un valor generado/default compatible. `DEFAULT NULL` no cuenta; una
columna `PRIMARY KEY` también es required, y retirar después el default de una
columna required vuelve insegura la expansión. Esto incluye `PRIMARY KEY` de
tabla sobre una columna recién agregada, `SET DEFAULT NULL`, `DROP DEFAULT` y
`DROP IDENTITY` posteriores. Un `ON DELETE SET DEFAULT` referencial no es un
default propio. `SERIAL` e `IDENTITY` sí cuentan como valores generados mientras
no se retiren.

Los cambios incompatibles se separan en tres despliegues:

1. **Expand:** agregar objetos compatibles y ejecutar `prisma migrate deploy`
   antes de reemplazar la aplicación.
2. **Migrar consumidores:** backfill si aplica, retirar del código el uso del
   objeto antiguo y crear o actualizar en ese mismo commit el manifiesto
   `prisma/migration-contracts/<id>.json`. Luego desplegar y verificar ese commit
   en producción.
3. **Contract:** en una migración posterior, declarar
   `-- onestar:contract-after <sha>` y `-- onestar:contract-id <id>`, y recién
   entonces eliminar o renombrar el objeto. CI exige que `<sha>` exista y sea
   ancestro del SHA base, que ese commit haya creado o actualizado el manifiesto
   válido, que `objects` coincida exactamente con los objetivos canónicos del
   DDL y que su contenido sea byte-a-byte idéntico en preparación, base y
   `HEAD`, sin cambios intermedios aunque se restauren los mismos bytes. Un merge
   que integra el manifiesto puede ser el SHA de preparación si lo cambia contra
   su primer padre; un merge ajeno no sirve. La historia entre base y `HEAD`
   tampoco puede tocar el manifiesto. Cada ID sólo
   autoriza una migración: CI rechaza duplicados nuevos o un marcador ya
   consumido en la base. Antes de correr `migrate deploy`, el operador todavía
   debe confirmar manualmente que el commit de preparación sí llegó a
   producción.

El esquema v1, el formato `table:/column:/type:/constraint:` de los objetivos y
la secuencia operativa están definidos en
`prisma/migration-contracts/README.md`. Para verificar unicidad, CI sólo indexa
marcadores `contract-id` históricos; no reevalúa el DDL aplicado. Si la evidencia
cambia después de la preparación, la contracción falla y requiere un contrato
nuevo.

El gate detecta `DROP TABLE/COLUMN/TYPE/CONSTRAINT`, renombres de tabla o
columna, `TRUNCATE`, cambios de tipo, `SET NOT NULL` y columnas nuevas `NOT NULL`
sin default; ignora menciones dentro de comentarios y literales SQL. No existe
bypass silencioso. `DO` y `CALL` top-level se rechazan porque el SQL procedural
no puede verificarse estáticamente; esto no amplía el catálogo DDL y DML sigue
fuera de alcance. En producción siguen prohibidos `prisma db push` y
`prisma migrate dev`.

El reverse proxy es también la frontera de confianza para el límite de login
administrador: debe eliminar cualquier `X-Real-IP` recibido del cliente y
reescribirlo con la IP remota observada. La aplicación valida exclusivamente
esa cabecera e ignora `X-Forwarded-For`; si `X-Real-IP` falta o no contiene una
IP válida, agrupa el intento bajo `unknown` para fallar de forma cerrada. El
contenedor `app` no debe exponerse directamente a Internet.

El límite admite cinco intentos por correo e IP confiable cada quince minutos.
Cuando la IP no es confiable, el balde compartido `unknown` admite veinte para
reducir el riesgo de que un tercero bloquee al administrador, pero nunca omite
el control: el vigesimoprimero se rechaza antes de consultar credenciales. Una
cabecera ausente, vacía o inválida también genera un evento Sentry `warning`
con fingerprint estable y únicamente tags operativos (`security_event` y
`reason`); no se envían correo, contraseña, IP ni el valor crudo de la cabecera.
Como defensa final, el `beforeSend` del proceso Node reconstruye este evento
desde una allowlist: solo conserva `event_id`, `timestamp`, `platform`, `level`,
`message`, `fingerprint` y los tags exactos `security_event` y `reason`. Request,
cookies, usuario, breadcrumbs, contexts, extra, transacción, excepción y
cualquier otro campo heredado se descartan; los demás tipos de evento Sentry no
se modifican.

El proceso deduplica la alerta durante quince minutos después de que
`captureMessage` retorna correctamente. Si Sentry lanza una excepción, la
autenticación continúa y la siguiente solicitud puede reintentar la alerta sin
esperar el cooldown. Para convertir el evento en una notificación a personas
todavía debe configurarse la regla correspondiente en el proyecto de Sentry;
esa configuración externa no pertenece al código de la aplicación.

## Capa ERP — Referencia Rápida

```
src/server/erp/
├── ports/erp.port.ts        ← IERPAdapter — LEER ANTES de tocar integraciones
├── adapters/
│   ├── null.adapter.ts      ← activo en dev (ERP_PROVIDER=null)
│   ├── alegra.client.ts     ← HTTP client Alegra (no usar directamente)
│   ├── alegra.adapter.ts    ← implementación Alegra
│   ├── loggro.client.ts     ← HTTP client Loggro (no usar directamente)
│   └── loggro.adapter.ts    ← implementación Loggro
├── erp.container.ts         ← getERPAdapter() — punto de entrada
├── erp.types.ts             ← ERPInvoice, ERPCustomer, ERPSyncResult, …
└── index.ts                 ← barrel: import { getERPAdapter } from "@/server/erp"
```

**Documentación Detallada de Integraciones:**
- [Loggro ERP: Arquitectura de Sincronización y Agrupación de Catálogo](docs/integrations/loggro-erp.md)

**Regla:** El código de negocio SOLO importa desde `@/server/erp` (el barrel).
Nunca importar adaptadores o clientes directamente.
