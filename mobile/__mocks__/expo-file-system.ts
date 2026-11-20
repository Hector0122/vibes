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
export function mockFsReset(): void {
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
