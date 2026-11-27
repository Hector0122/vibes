# Vibes Worker

Backend personal de Vibes: un Cloudflare Worker sobre un bucket R2 (audio) y una base D1
(metadata). Un solo usuario, un token. Contrato de la API: `../src/shared/api.ts`.
Configuración: ver el [README principal](../README.md#tu-nube-una-sola-vez).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/v1/health` | Comprueba el token |
| GET | `/v1/songs` | Canciones completas con su metadata |
| POST | `/v1/songs/{id}/upload` | Registra la canción y da una URL firmada para subir el audio (o `null` si ya está) |
| POST | `/v1/songs/{id}/commit` | La publica cuando el audio ya está completo en R2 |
| GET | `/v1/songs/{id}/stream` | URL firmada para reproducir o descargar |
| DELETE | `/v1/songs/{id}` | Borra audio y metadata |
| GET | `/v1/velody` | Canciones mandadas a Velody (la app de práctica), en orden |
| PUT | `/v1/velody/{id}` | Manda una canción a Velody (tiene que estar completa en la nube; no audiolibros) |
| DELETE | `/v1/velody/{id}` | La quita de esa lista (Velody, al terminar de importarla, o el usuario) |
| GET | `/v1/podcasts/subscriptions` | Tus podcasts suscritos |
| PUT | `/v1/podcasts/subscriptions/{id}` | Suscribirse (cuerpo: `title`, `author`, `image`) |
| DELETE | `/v1/podcasts/subscriptions/{id}` | Quitar la suscripción |

El Worker solo guarda tus suscripciones a podcasts. La búsqueda y los episodios los pide el celular
directo al directorio de Apple Podcasts (gratis, sin cuenta): Apple rechaza las llamadas que salen de
Cloudflare. El audio tampoco pasa por el Worker: suena directo del servidor de cada podcast.

`pnpm test` corre la API con el SQL real de `migrations/` sobre SQLite y un R2 en memoria.
