export interface Env {
  BUCKET: R2Bucket
  DB: D1Database
  R2_BUCKET_NAME: string
  API_TOKEN?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  /** Podcast Index (podcastindex.org) API key and secret, for the Podcasts tab. */
  PODCASTINDEX_KEY?: string
  PODCASTINDEX_SECRET?: string
}
