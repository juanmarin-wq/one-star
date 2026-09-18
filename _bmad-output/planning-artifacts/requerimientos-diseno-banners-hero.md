# Requerimientos técnicos — Banners y Hero (para pedir diseños a marcas)

**Verificado directamente en el código** (`src/components/home/HeroBanner.tsx`, `Banner` en `prisma/schema.prisma`, `/api/upload`), no son suposiciones.

---

## 1. Cómo funciona hoy (para que el diseñador no se equivoque)

- **El Hero es un carrusel de banners.** Cada banner = 1 imagen o video de fondo + un texto (título) que la web superpone encima, no va horneado en la imagen.
- **NO manden el texto/título incluido en el diseño.** El título, la posición del texto (arriba/centro/abajo × izquierda/centro/derecha) y el botón (CTA) los pone la web por configuración. Si el diseño ya trae texto escrito, se duplica o queda descuadrado.
- **Una sola imagen sirve para desktop Y mobile** (hoy no existe un campo separado de "imagen mobile"). El mismo archivo se recorta automáticamente centrado (`object-cover`) en ambos tamaños — por eso el punto 3 (zona segura) es obligatorio.
- Puede ser **imagen o video** (`mediaType`: `image` | `video`).

## 2. Medidas

| Pieza | Ancho × Alto recomendado | Relación de aspecto | Notas |
|---|---|---|---|
| **Hero principal** (el primer banner del home) | **1920 × 1300 px** mínimo | ~3:2 (vertical-friendly) | Ocupa 85% del alto de pantalla (`85vh`) en desktop. Necesita más alto de lo normal para no perder contenido al recortar en mobile. |
| **Hero secundario** (banners 2do en adelante del mismo carrusel) | **1920 × 1000 px** mínimo | ~9:5 | Ocupa 60-70% del alto de pantalla. |
| **Video de Hero** | 1920 × 1080 px (Full HD), MP4 (H.264) | 16:9 | Máximo 30 MB por archivo (límite duro del servidor). Recomendado: 10-15 segundos, loop suave, sin audio necesario (no hay control de sonido en el reproductor). |

**Formato de imagen:** JPG u optimizado (WebP también sirve, el sistema lo re-procesa). Peso recomendado bajo 500 KB por imagen para que cargue rápido — el límite duro del servidor es 30 MB pero eso es demasiado pesado para web.

## 3. Zona segura (safe zone) — LO MÁS IMPORTANTE

Como la misma imagen se ve completa en desktop (panorámica, ancha y baja) y recortada en mobile (angosta y alta), **el elemento principal del diseño (producto, modelo, logo) debe estar centrado en el tercio central horizontal de la imagen**. Todo lo que quede muy a los costados (izquierda/derecha extremos) se pierde en el recorte mobile.

Además, dejen espacio "limpio" (sin detalles importantes de la foto) en una de estas zonas, porque ahí va a caer el texto que pone la web encima:
- Esquina inferior izquierda (posición por defecto), o
- Centro, o
- Cualquiera de las 9 posiciones (arriba/centro/abajo × izquierda/centro/derecha) — definimos la posición exacta antes de publicar cada banner.

## 4. Checklist para pedirle a las marcas

- [ ] Imagen SIN texto ni logo de marca superpuesto en una posición fija (si llevan logo, que esté en una esquina discreta, nunca en el centro).
- [ ] Elemento principal centrado horizontalmente (zona segura para recorte mobile).
- [ ] Una zona limpia para overlay de texto (una esquina o el centro, a elección).
- [ ] Resolución mínima 1920 px de ancho.
- [ ] Formato JPG/WebP optimizado (o MP4 si es video, máx. 30 MB).
- [ ] Entregar en **una sola pieza** (no hay versión separada mobile/desktop hoy — si quieren controlar mejor el recorte mobile, avísenme para evaluar agregar ese campo antes del lanzamiento).

---

*Documento generado a partir del código real de `one-star` (2026-09-17). Si cambia el diseño del Hero antes del lanzamiento, este documento puede quedar desactualizado — verificar contra `src/components/home/HeroBanner.tsx`.*
