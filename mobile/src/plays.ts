// Plays counted on the phone (30 s listened, like the desktop), sent to the cloud
// for the computer to add to its counts. Kept in vibes/plays.json until sent, so
// what you listen to offline counts once you're back online.
import { File, Paths } from 'expo-file-system'
import { MAX_PLAYS_PER_POST, type Play } from '../../src/shared/api'
import type { Cloud } from './cloud'

const file = (): File => new File(Paths.document, 'vibes', 'plays.json')
let cloud: Cloud | null = null
let chain: Promise<unknown> = Promise.resolve()

async function read(): Promise<Play[]> {
  try {
    const f = file()
    return f.exists ? ((JSON.parse(await f.text()) as Play[]) ?? []) : []
  } catch {
    return []
  }
}

/** One change at a time, so a send and a new play don't overwrite each other. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.catch(() => {})
  return run
}

export function setPlaysCloud(c: Cloud | null): void {
  cloud = c
}

export function recordPlay(id: string, at: number): Promise<void> {
  return serial(async () => {
    const list = await read()
    list.push({ id, at })
    await file().write(JSON.stringify(list.slice(-5000)))
  }).then(() => flushPlays().then(() => undefined))
}

/** Sends what's pending; keeps it on failure (offline). */
export function flushPlays(): Promise<number> {
  return serial(async () => {
    const c = cloud
    if (!c) return 0
    let list = await read()
    let sent = 0
    while (list.length) {
      const batch = list.slice(0, MAX_PLAYS_PER_POST)
      try {
        await c.sendPlays(batch)
      } catch {
        break
      }
      list = list.slice(batch.length)
      sent += batch.length
      await file().write(JSON.stringify(list))
    }
    return sent
  })
}
