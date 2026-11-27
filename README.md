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

Para sacar una versión: sube el número en `package.json` y `mobile/app.json` (y `versionCode`), y publica una
etiqueta `git tag -a vX.Y.Z -m "Vibes X.Y.Z" && git push origin vX.Y.Z`, o desde GitHub (también en el
celular): **Actions → CI → Run workflow** en `main` con la versión. La app del celular avisa sola de la nueva, y la de escritorio instalada con el `.deb` también: al abrirla muestra *Hay una versión nueva* → **Actualizar** baja el `.deb`, lo instala (pide tu contraseña en la ventana del sistema) y se reinicia ya actualizada; con AppImage abre la página de la versión. GitHub Actions corre todas las pruebas,
arma los instaladores y crea la release (~25 min, la APK es lo más lento). El CI corre **solo** al publicar
una versión, no en cada push ni en los PR: corre las pruebas localmente antes (ver *Desarrollo*).

## Qué hace hoy (v1.2)

**Escritorio (Electron)**

- **Inicio**: buscador de YouTube y "Recomendado para ti" (mezclas de YouTube de canciones de tu
  biblioteca, sin las que ya tienes). ▶ para escuchar sin agregar, **Agregar** para descargarla, guardarla
  y subirla a la nube. Las portadas y el álbum reales salen de Deezer.
- **Biblioteca**: tabla con búsqueda, solo guardadas, reproducir todo / aleatorio, estado por canción
  (en la nube, sin audio, error) y los errores agrupados arriba.
- **Mandar a Velody**: en cada canción que ya está en la nube, el botón de la púa la manda a
  [Velody](https://github.com/Hector0122/velody-native) (la app para practicar), que la baja, la separa en
  pistas y la quita de la lista. En el celular: deja presionada la canción → *Mandar a Velody*.
- **Playlists**: crear, renombrar, eliminar; agregar con el **+** de cada canción o arrastrándola a la
  barra lateral; reordenar arrastrando.
- **Reproductor**: reproducción automática, aleatorio tipo baraja (todas suenan antes de repetir),
  "anterior" real, volumen, teclas multimedia, **radio sin fin** (al acabarse la lista siguen canciones
  parecidas). El color de la app sigue a la portada que suena.
- **Reproduciendo ahora**: clic en la canción del reproductor → portada grande y **letra sincronizada**
  (LRCLIB; se guarda en disco).
- **Herramientas**: importar de eSound (solo con la biblioteca vacía), descargar faltantes, subir a la nube.
- Cuenta reproducciones (a los 30 s) para afinar las recomendaciones, también las del celular.
- Con la nube configurada: descarga lo que marcas en el celular, sube sus playlists y sugerencias, y aplica
  las playlists que editas en el celular (revisa cada 2 minutos).

**Celular (`mobile/`, Expo)**

- Escucha tu nube: lista, búsqueda, aleatorio y reproducción automática con el **reproductor nativo de
  Android**: la siguiente canción ya está cargada, así sigue sonando con la pantalla apagada, y la pantalla
  bloqueada tiene ⏮ ⏯ ⏭. La primera vez pide la URL del Worker y tu token (el de
  `~/.config/vibes/api_token`); se guardan en el almacén seguro del teléfono.
- **Sigue donde te quedaste**: al abrir aparece la última canción, en pausa, en el mismo segundo.
- **Temporizador** (🌙 en el reproductor): parar en 15/30/45/60 min o al terminar la canción.
- **Reproduciendo**: toca la canción en la barra → portada grande y **letra sincronizada** (LRCLIB; se guarda
  para verla sin internet; toca una línea para ir ahí).
- **Widget** en la pantalla de inicio (mantén presionado el fondo → Widgets → Vibes): canción actual y
  ⏮ ▶/⏸ ⏭ sin abrir la app. Con la app cerrada toca **solo lo descargado** (sin internet): retoma tu última
  canción si está descargada, si no, aleatorio de las descargadas.
- **Abajo: Inicio · Música · Libros · Podcasts.** Cada pestaña agrega lo suyo con el **➕** de arriba (música,
  audiolibros, podcasts). **Inicio**: accesos a tus playlists, *Recomendado para ti* y
  tus artistas. **Música**: Canciones (recientes o **A–Z** con letras para saltar), Artistas y
  Playlists; una playlist o un artista se abre con **Reproducir** y **Aleatorio**.
- **Playlists**: las de la computadora aparecen en Música → Playlists. En el celular: **Nueva playlist**,
  deja presionada una canción para agregarla a una playlist o quitarla, y ⋯ para renombrar o eliminar
  (necesita internet; la compu recibe los cambios).
- **Mantener descargada** una playlist (en su ⋯): baja sola lo que le falte, también las canciones nuevas.
  **Descargar solo con Wi-Fi** (activado): lo automático espera al Wi-Fi y una descarga a mano con datos
  pregunta antes.
- **Sin internet**: ⬇ en cada canción, o "Descargar las N" para toda la lista o playlist. Las descargadas
  suenan desde el teléfono; sin conexión la app abre con tu última biblioteca y solo muestra lo descargado.
  El botón 📱 filtra a "solo descargadas"; ✓ quita una del teléfono (sigue en la nube).
- Lo que escuchas 30 s cuenta para las sugerencias (se manda a la compu; sin internet, después).
- **Agregar música** (➕ arriba en Música): busca en Deezer (sin API key) o elige de "Recomendado para ti"; ▶ suena
  un clip de 30 s. Toca **Agregar** y la canción queda en "Esperando a la compu": la próxima vez que Vibes esté
  abierto en la computadora (revisa cada 2 minutos) la busca en YouTube, la descarga con yt-dlp, la sube y
  aparece en el celular. Si no se pudo, ves el motivo y puedes reintentar o cancelar.
- **Podcasts**: busca cualquier podcast (Podcast Index, gratis) y **suscríbete** para tenerlo en la
  pestaña (➕ arriba en Podcasts). Abre uno → sus episodios, del más nuevo al más viejo; toca uno para escucharlo. Suena directo
  del servidor del podcast (no usa espacio en tu nube), con el mismo reproductor, pantalla bloqueada y
  temporizador. Cada episodio **recuerda dónde lo dejaste** ("Quedan 23 min"), y uno terminado queda como
  *Escuchado*. Mantén presionado un episodio (o toca su descripción) para leerla completa. Necesita las
  llaves de Podcast Index en el Worker (ver *Tu nube*).
- Al abrir revisa las releases de este repo: si hay una versión más nueva te ofrece descargar su APK.
- Para desarrollo: `cd mobile && pnpm install && pnpm start` y escanea el QR con **Expo Go**.

### Pendiente / siguiente

- **Probar la 1.2 en un teléfono real** antes de publicarla: el reproductor nativo (pantalla apagada,
  ⏮ ⏭ en la pantalla bloqueada) y el widget dependen de Android y no se pueden probar aquí (las pruebas
  automáticas y el empaquetado sí pasan). APK de prueba: Actions → CI → Run workflow en la rama, y bajar
  `vibes-android` de los *Artifacts* de la corrida.
- Opcional: Groq para pedir música con palabras ("algo tranquilo para trabajar").

## Requisitos

- Node 22+ y pnpm
- `ffmpeg` y `yt-dlp` en el PATH (o en `VIBES_FFMPEG` / `VIBES_YTDLP`)
- Una cuenta de Cloudflare (el plan gratis alcanza) si quieres la nube

## Instalar (Linux)

```bash
pnpm build:linux                                  # genera dist/vibes_<versión>_amd64.deb y dist/Vibes-<versión>.AppImage
sudo apt install ./dist/vibes_1.2.0_amd64.deb     # queda en el menú como "Vibes"
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

> **Al actualizar:** cuando cambie algo en `worker/`, desde esa carpeta corre `git pull` y luego
> `pnpm migrate:remote && pnpm run deploy` (aplica las tablas nuevas y sube el código nuevo).

Crea un token de R2 en el dashboard de Cloudflare → R2 → *Manage API tokens* → **Object Read &
Write** solo para el bucket `vibes`. Luego guarda los secretos (nunca van en el repo):

```bash
openssl rand -base64 48                       # tu token personal; guárdalo
pnpm exec wrangler secret put API_TOKEN
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm run deploy
```

**Podcasts** (opcional): crea una cuenta gratis en [api.podcastindex.org](https://api.podcastindex.org),
que te da una *API Key* y un *API Secret*, y guárdalos como secretos:

```bash
pnpm exec wrangler secret put PODCASTINDEX_KEY
pnpm exec wrangler secret put PODCASTINDEX_SECRET
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
