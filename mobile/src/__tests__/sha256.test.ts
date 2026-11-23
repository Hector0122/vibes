import { Sha256 } from '../sha256'

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const hash = (b: Uint8Array) => new Sha256().update(b).digest()

it('gives the standard SHA-256 values (FIPS 180-2 test vectors)', () => {
  expect(hash(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  expect(hash(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(hash(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  )
  expect(hash(new Uint8Array(1_000_000).fill(97))).toBe(
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
  )
})

it('fed in pieces of any size, it gives the same hash as all at once', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255)
    const h = new Sha256()
    for (let i = 0; i < n; i += 37) h.update(data.subarray(i, i + 37))
    expect(h.digest()).toBe(hash(data))
  }
})
