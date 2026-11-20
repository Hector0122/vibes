# Vibes 🎧

Tu música sin anuncios. Vibes importa tu biblioteca de **eSound**, busca y descarga canciones de
YouTube con **yt-dlp** y guarda todo en **tu propio Cloudflare** (R2 + D1), para escucharla en la
computadora y en el celular.

> **Uso personal.** Vibes descarga audio de YouTube con yt-dlp, lo cual va contra los términos de
> servicio de YouTube. Úsalo solo con tu propia biblioteca y bajo tu responsabilidad. Este repo no
> incluye música ni datos de nadie.

## Descargar

En **[Releases](../../releases)** de GitHub, cada versión (`v1.0.0`, …) trae:

- `vibes_<versión>_amd64.deb` → `sudo apt install ./vibes_*.deb` (queda en el menú como "Vibes")
- `Vibes-<versión>.AppImage` → sin instalar
- `vibes-<versión>.apk` → Android (permite apps de "fuentes desconocidas"); también corre en Waydroid:
  `waydroid app install vibes-*.apk`

Para sacar una versión: sube el número en `package.json` y `mobile/app.json`, y publica una etiqueta
`git tag -a vX.Y.Z -m "Vibes X.Y.Z" && git push origin vX.Y.Z`. GitHub Actions corre todas las pruebas,
arma los instaladores y crea la release (~25 min, la APK es lo más lento). Cada push a `main` también deja
los instaladores como *Artifacts* de la corrida.

## Qué hace hoy (v1.0)

**Escritorio (Electron)**

- **Inicio**: buscador de YouTube y "Recomendado para ti" (mezclas de YouTube de canciones de tu
  biblioteca, sin las que ya tienes). ▶ para escuchar sin agregar, **Agregar** para descargarla, guardarla
  y subirla a la nube. Las portadas y el álbum reales salen de Deezer.
- **Biblioteca**: tabla con búsqueda, solo guardadas, reproducir todo / aleatorio, estado por canción
  (en la nube, sin audio, error) y los errores agrupados arriba.
- **Playlists**: crear, renombrar, eliminar; agregar con el **+** de cada canción o arrastrándola a la
  barra lateral; reordenar arrastrando.
- **Reproductor**: reproducción automática, aleatorio tipo baraja (todas suenan antes de repetir),
  "anterior" real, volumen, teclas multimedia, **radio sin fin** (al acabarse la lista siguen canciones
  parecidas). El color de la app sigue a la portada que suena.
- **Reproduciendo ahora**: clic en la canción del reproductor → portada grande y **letra sincronizada**
  (LRCLIB; se guarda en disco).
- **Herramientas**: importar de eSound (solo con la biblioteca vacía), descargar faltantes, subir a la nube.
- Cuenta reproducciones (a los 30 s) para afinar las recomendaciones.

**Celular (`mobile/`, Expo)**

- Escucha tu nube: lista, búsqueda, aleatorio, reproducción automática, sigue sonando con la pantalla
  apagada y muestra la canción en la pantalla bloqueada. La primera vez pide la URL del Worker y tu token
  (el de `~/.config/vibes/api_token`); se guardan en el almacén seguro del teléfono.
- **Playlists**: las que armas en la computadora aparecen arriba como pestañas (se suben solas a la nube
  cada vez que cambian).
- **Sin internet**: ⬇ en cada canción, o "Descargar las N" para toda la lista o playlist. Las descargadas
  suenan desde el teléfono; sin conexión la app abre con tu última biblioteca y solo muestra lo descargado.
  El botón 📱 filtra a "solo descargadas"; ✓ quita una del teléfono (sigue en la nube).
- **Agregar música** (➕ arriba): busca en Deezer (sin API key) o elige de "Recomendado para ti"; ▶ suena
  un clip de 30 s. Toca **Agregar** y la canción queda en "Esperando a la compu": la próxima vez que Vibes esté
  abierto en la computadora (revisa cada 2 minutos) la busca en YouTube, la descarga con yt-dlp, la sube y
  aparece en el celular. Si no se pudo, ves el motivo y puedes reintentar o cancelar.
- Para desarrollo: `cd mobile && pnpm install && pnpm start` y escanea el QR con **Expo Go**.

### Pendiente / siguiente

- Probar la APK 1.0.1 en un celular real y en Waydroid (las pruebas automáticas pasan; en un teléfono aún no).
- El conteo de reproducciones vive solo en la computadora.
- Celular: siguiente/anterior en la pantalla bloqueada.
- Opcional: Groq para pedir música con palabras ("algo tranquilo para trabajar").

## Requisitos

- Node 22+ y pnpm
- `ffmpeg` y `yt-dlp` en el PATH (o en `VIBES_FFMPEG` / `VIBES_YTDLP`)
- Una cuenta de Cloudflare (el plan gratis alcanza) si quieres la nube

## Instalar (Linux)

```bash
pnpm build:linux                                  # genera dist/vibes_<versión>_amd64.deb y dist/Vibes-<versión>.AppImage
sudo apt install ./dist/vibes_1.0.1_amd64.deb     # queda en el menú como "Vibes"
```

El `.deb` instala `ffmpeg` como dependencia. `yt-dlp` instálalo aparte con `pipx install yt-dlp` (el de apt
suele estar viejo para YouTube); la app lo encuentra aunque esté en `~/.local/bin`.

## Desarrollo

```bash
pnpm install
pnpm dev               # abre la app
pnpm test              # unitarias e integración (incluye el cliente del celular contra el Worker real)
pnpm test:e2e          # compila y prueba el flujo completo en la app real (Deezer/LRCLIB/YouTube falsos)
pnpm test:e2e:dist     # el mismo flujo sobre la app empaquetada (después de pnpm build:linux)
(cd worker && pnpm test)   # API del Worker con el SQL real de la migración
(cd mobile && pnpm test)   # pantallas del celular (Jest + Testing Library)
```

Código compartido entre escritorio y celular: `src/shared/` (contrato de la API y la lógica de qué
canción sigue).

## Tu nube (una sola vez)

Desde `worker/`:

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create vibes
pnpm exec wrangler d1 create vibes      # copia el database_id a wrangler.toml
pnpm migrate:remote
```

> **Actualizando de una versión anterior:** las playlists, la cola del celular y las sugerencias necesitan
> tablas nuevas. Desde `worker/` corre `pnpm migrate:remote && pnpm deploy` una vez.

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
Escritorio (Electron)        Cloudflare (tu cuenta)          Celular (Expo)
┌──────────────────┐        ┌────────────────────────┐      ┌──────────────────┐
│ importa eSound    │        │ Worker /v1 + token      │      │ lista tu nube     │
│ busca/baja yt-dlp │──sube─▶│ D1: canciones (metadata)│◀─────│ reproduce de R2   │
│ reproductor local │        │ R2: songs/{id}.m4a      │      │ (URL firmada)     │
└──────────────────┘        └────────────────────────┘      └──────────────────┘
```

- El ID de cada canción es su ID de video de YouTube, así que nunca se duplica.
- El audio viaja directo entre la app y R2 con URLs firmadas de 15 minutos; las credenciales de R2
  solo viven en el Worker.
- Una canción solo aparece en la nube cuando su audio está completo en R2.

## Licencia

MIT. Ver [LICENSE](LICENSE).
