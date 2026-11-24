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
  searchYoutube: (query) => ipcRenderer.invoke('youtube:search', query),
  recommend: () => ipcRenderer.invoke('youtube:recommend'),
  radio: (id) => ipcRenderer.invoke('youtube:radio', id),
  addSong: (result) => ipcRenderer.invoke('songs:add', result),
  songPlayed: (id) => ipcRenderer.invoke('songs:played', id),
  coverColor: (url) => ipcRenderer.invoke('cover:color', url),
  lyrics: (song) => ipcRenderer.invoke('lyrics:get', song),
  listPlaylists: () => ipcRenderer.invoke('playlists:list'),
  createPlaylist: (name) => ipcRenderer.invoke('playlists:create', name),
  renamePlaylist: (id, name) => ipcRenderer.invoke('playlists:rename', id, name),
  deletePlaylist: (id) => ipcRenderer.invoke('playlists:delete', id),
  addToPlaylist: (id, songIds) => ipcRenderer.invoke('playlists:add', id, songIds),
  removeFromPlaylist: (id, songId) => ipcRenderer.invoke('playlists:remove-song', id, songId),
  movePlaylistSong: (id, from, to) => ipcRenderer.invoke('playlists:move', id, from, to),
  getCloudSettings: () => ipcRenderer.invoke('cloud:get-settings'),
  saveCloudSettings: (input) => ipcRenderer.invoke('cloud:save-settings', input),
  testCloud: (input) => ipcRenderer.invoke('cloud:test', input),
  onSongUpdated: (cb) => on('song-updated', cb),
  deleteSongs: (ids) => ipcRenderer.invoke('songs:delete', ids),
  sendToVelody: (ids) => ipcRenderer.invoke('velody:send', ids),
  listVelodySends: () => ipcRenderer.invoke('velody:list'),
  onSongsRemoved: (cb) => on('songs-removed', cb),
  onPlaylistsChanged: (cb) => on('playlists-changed', () => cb()),
  onProgress: (cb) => on('progress', cb)
}

contextBridge.exposeInMainWorld('api', api)
