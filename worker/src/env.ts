export interface Env {
  BUCKET: R2Bucket
  DB: D1Database
  R2_BUCKET_NAME: string
  API_TOKEN?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  /** YouTube Data API key, for searching from the phone. Optional. */
  YOUTUBE_API_KEY?: string
}
