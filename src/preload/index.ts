import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { VibesAPI } from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: VibesAPI = {
  listSongs: () => ipcRenderer.invoke('songs:list'),
  audioUrl: (id) => ipcRenderer.invoke('songs:audio-url', id),
  importEsound: () => ipcRenderer.invoke('esound:import'),
  downloadMissing: () => ipcRenderer.invoke('songs:download-missing'),
  uploadToCloud: () => ipcRenderer.invoke('cloud:upload'),
  getCloudSettings: () => ipcRenderer.invoke('cloud:get-settings'),
  saveCloudSettings: (input) => ipcRenderer.invoke('cloud:save-settings', input),
  testCloud: (input) => ipcRenderer.invoke('cloud:test', input),
  onSongUpdated: (cb) => on('song-updated', cb),
  onProgress: (cb) => on('progress', cb)
}

contextBridge.exposeInMainWorld('api', api)
