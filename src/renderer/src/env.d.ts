/// <reference types="vite/client" />
import type { VibesAPI } from '../../shared/types'

declare global {
  interface Window {
    api: VibesAPI
  }
}
