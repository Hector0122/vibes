import { useEffect, useState } from 'react'
import type { CloudSettingsView } from '../../shared/types'

export function CloudSettings({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [view, setView] = useState<CloudSettingsView | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    window.api.getCloudSettings().then((v) => {
      setView(v)
      setUrl(v.url)
      setEnabled(v.enabled || !v.url)
    })
  }, [])

  const input = { url, token, enabled }
  const clean = (e: unknown): string =>
    (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Nube"
        className="w-[28rem] space-y-3 rounded-lg bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Tu nube (Cloudflare Worker)</h2>
        <label className="block text-sm">
          URL del Worker
          <input
            className="mt-1 w-full rounded bg-neutral-800 px-3 py-1.5"
            placeholder="https://vibes-cloud.<tu-cuenta>.workers.dev"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Token {view?.hasToken && <span className="text-neutral-500">(guardado; déjalo vacío para conservarlo)</span>}
          <input
            type="password"
            className="mt-1 w-full rounded bg-neutral-800 px-3 py-1.5"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {view && !view.encryptionAvailable && (
          <p className="text-sm text-amber-400">
            Este sistema no tiene llavero seguro disponible; el token no se puede guardar.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Usar la nube
        </label>
        {status && <p className="text-sm text-neutral-400">{status}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            className="btn"
            onClick={async () => {
              setStatus('Probando…')
              const r = await window.api.testCloud(input)
              setStatus(r.ok ? 'Conexión correcta ✓' : r.error)
            }}
          >
            Probar
          </button>
          <button
            className="btn bg-violet-600 hover:bg-violet-500"
            onClick={async () => {
              try {
                setView(await window.api.saveCloudSettings(input))
                setToken('')
                onClose()
              } catch (e) {
                setStatus(clean(e))
              }
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
