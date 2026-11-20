import { useEffect, useState } from 'react'
import type { CloudSettingsView } from '../../shared/types'
import { CloudIcon } from './icons'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Nube"
        className="w-[30rem] space-y-4 rounded-2xl bg-neutral-900 p-6 shadow-2xl shadow-black/60 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 to-pink-500">
            <CloudIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Tu nube</h2>
            <p className="text-xs text-neutral-400">Cloudflare Worker donde se guarda tu música</p>
          </div>
        </div>
        <label className="block text-sm font-medium text-neutral-300">
          URL del Worker
          <input
            className="field mt-1.5 rounded-lg"
            placeholder="https://vibes-cloud.<tu-cuenta>.workers.dev"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-neutral-300">
          Token{' '}
          {view?.hasToken && <span className="font-normal text-neutral-500">(guardado; déjalo vacío para conservarlo)</span>}
          <input
            type="password"
            className="field mt-1.5 rounded-lg"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <span className="mt-1.5 block text-xs font-normal text-neutral-500">
            Es el contenido del archivo <code className="text-neutral-400">~/.config/vibes/api_token</code>
          </span>
        </label>
        {view && !view.encryptionAvailable && (
          <p className="text-sm text-amber-400">
            Este sistema no tiene llavero seguro disponible; el token no se puede guardar.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-violet-500"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Usar la nube
        </label>
        {status && (
          <p className={`rounded-lg px-3 py-2 text-sm ${status.includes('✓') ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-neutral-300'}`}>
            {status}
          </p>
        )}
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
            className="btn-accent"
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
