# Vibes 🎧

Tu música sin anuncios. Vibes importa tu biblioteca de **eSound**, descarga lo que falte con
**yt-dlp** y guarda todo en **tu propio Cloudflare** (R2 + D1), para escucharla en escritorio y, más
adelante, en el celular.

> **Uso personal.** Vibes descarga audio de YouTube con yt-dlp, lo cual va contra los términos de
> servicio de YouTube. Úsalo solo con tu propia biblioteca y bajo tu responsabilidad. Este repo no
> incluye música ni datos de nadie.

## Qué hace hoy (fase 1)

- **Importar de eSound**: lee la base de datos local de eSound (sin modificarla), trae tus canciones
  con su ID de YouTube, Deezer e ISRC, y copia los audios que eSound ya tenía en caché.
- **Descargar faltantes**: baja con yt-dlp el audio (m4a) de las canciones que no estaban en caché.
- **Reproductor**: búsqueda, solo guardadas, anterior/siguiente, aleatorio, adelantar y teclas
  multimedia.
- **Subir a la nube**: sube cada canción a tu bucket R2 y su metadata a D1, con un Worker de
  Cloudflare protegido por un token personal. Lo que ya está arriba no se vuelve a subir.

### Siguiente

- **Fase 2: recomendaciones.** Deezer da canciones reales parecidas a las tuyas y Groq las elige y
  ordena según tu gusto (la llave de Groq vive como secreto del Worker). Buscador para agregar
  canciones nuevas.
- **Fase 3: Android.** React Native, reproduce desde tu R2.

## Requisitos

- Node 22+ y pnpm
- `ffmpeg` y `yt-dlp` en el PATH (o en `VIBES_FFMPEG` / `VIBES_YTDLP`)
- Una cuenta de Cloudflare (el plan gratis alcanza) si quieres la nube

## Desarrollo

```bash
pnpm install
pnpm dev          # abre la app
pnpm test         # pruebas unitarias e integración
pnpm test:e2e     # compila y prueba el flujo completo en la app real
```

## Tu nube (una sola vez)

Desde `worker/`:

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create vibes
pnpm exec wrangler d1 create vibes      # copia el database_id a wrangler.toml
pnpm migrate:remote
```

Crea un token de R2 en el dashboard de Cloudflare → R2 → *Manage API tokens* → **Object Read &
Write** solo para el bucket `vibes`. Luego guarda los secretos (nunca van en el repo):

```bash
openssl rand -base64 48                       # tu token personal; guárdalo
pnpm exec wrangler secret put API_TOKEN
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm deploy
```

En la app, botón **Nube**: pega la URL del Worker y tu token, prueba la conexión y guarda. El token se
guarda cifrado con el llavero del sistema.

## Cómo está armado

```
Escritorio (Electron)        Cloudflare (tu cuenta)
┌──────────────────┐        ┌────────────────────────┐
│ importa eSound    │        │ Worker /v1 + token      │
│ yt-dlp descarga   │──sube─▶│ D1: canciones (metadata)│
│ reproductor local │        │ R2: songs/{id}.m4a      │
└──────────────────┘        └────────────────────────┘
```

- El ID de cada canción es su ID de video de YouTube, así que nunca se duplica.
- El audio viaja directo entre la app y R2 con URLs firmadas de 15 minutos; las credenciales de R2
  solo viven en el Worker.
- Una canción solo aparece en la nube cuando su audio está completo en R2.

## Licencia

MIT. Ver [LICENSE](LICENSE).
