// Jest stand-in for expo-file-system (native): an in-memory disk. Downloads are
// "served" by mockDownloads (url → bytes); tests can make one fail or hang.
export const mockDisk = new Map<string, string>()
export const mockDirs = new Set<string>()
export const mockDownloads = {
  /** How many bytes each downloaded URL yields; default 1. */
  size: (_url: string): number => 1,
  /** Throw to make a download fail. */
  hook: async (_url: string): Promise<void> => {},
  urls: [] as string[]
}
/** Uploads (PUT to a signed URL) and the system file picker. */
export const mockUploads = { urls: [] as string[], status: 200 }
export const mockPick = { uris: [] as string[] }
export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 }

export function mockFsReset(): void {
  mockUploads.urls = []
  mockUploads.status = 200
  mockPick.uris = []
  mockDisk.clear()
  mockDirs.clear()
  mockDownloads.size = () => 1
  mockDownloads.hook = async () => {}
  mockDownloads.urls = []
}

type Part = string | File | Directory
const join = (parts: Part[]): string =>
  parts.map((p) => (typeof p === 'string' ? p : p.uri)).reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`)

export class Directory {
  readonly uri: string
  constructor(...parts: Part[]) {
    this.uri = join(parts)
  }
  get exists(): boolean {
    return mockDirs.has(this.uri)
  }
  create(): void {
    mockDirs.add(this.uri)
  }
}

export class File {
  uri: string
  constructor(...parts: Part[]) {
    this.uri = join(parts)
  }
  get exists(): boolean {
    return mockDisk.has(this.uri)
  }
  get size(): number {
    return mockDisk.get(this.uri)?.length ?? 0
  }
  get name(): string {
    return decodeURIComponent(this.uri.split('/').pop() ?? '')
  }
  open() {
    const data = mockDisk.get(this.uri) ?? ''
    let pos = 0
    return {
      readBytes: async (n: number) => {
        const chunk = Uint8Array.from(data.slice(pos, pos + n), (c) => c.charCodeAt(0))
        pos += chunk.length
        return chunk
      },
      close: () => {}
    }
  }
  createUploadTask(url: string) {
    const size = this.size
    let listener: ((p: { bytesSent: number; totalBytes: number }) => void) | null = null
    return {
      addListener: (_e: 'progress', l: typeof listener) => {
        listener = l
        return { remove: () => (listener = null) }
      },
      uploadAsync: async () => {
        listener?.({ bytesSent: size, totalBytes: size })
        mockUploads.urls.push(url)
        return { status: mockUploads.status, body: '', headers: {} }
      }
    }
  }
  static async pickFileAsync(): Promise<{ canceled: boolean; result: File[] | null }> {
    return mockPick.uris.length
      ? { canceled: false, result: mockPick.uris.map((u) => new File(u)) }
      : { canceled: true, result: null }
  }
  /** '' like the native one when the system doesn't say. */
  type = ''
  async bytes(): Promise<Uint8Array> {
    return Uint8Array.from(mockDisk.get(this.uri) ?? '', (c) => c.charCodeAt(0))
  }
  async text(): Promise<string> {
    const v = mockDisk.get(this.uri)
    if (v === undefined) throw new Error('no such file')
    return v
  }
  async write(content: string): Promise<void> {
    mockDisk.set(this.uri, content)
  }
  delete(): void {
    mockDisk.delete(this.uri)
  }
  moveSync(dest: File): void {
    const v = mockDisk.get(this.uri)
    if (v === undefined) throw new Error('no such file')
    mockDisk.delete(this.uri)
    mockDisk.set(dest.uri, v)
    this.uri = dest.uri
  }
  static async downloadFileAsync(url: string, dest: File): Promise<File> {
    mockDownloads.urls.push(url)
    await mockDownloads.hook(url)
    mockDisk.set(dest.uri, 'x'.repeat(mockDownloads.size(url)))
    return dest
  }
}

export const Paths = {
  document: new Directory('file:///docs'),
  availableDiskSpace: 10_000_000_000
}
