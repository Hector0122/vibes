import { checkForUpdate, isNewer, LATEST_RELEASE } from '../updates'

it('compares versions as numbers', () => {
  expect(isNewer('v1.1.0', '1.0.1')).toBe(true)
  expect(isNewer('v1.10.0', '1.9.9')).toBe(true)
  expect(isNewer('v2.0.0', '1.99.99')).toBe(true)
  expect(isNewer('v1.0.1', '1.0.1')).toBe(false)
  expect(isNewer('v1.0.0', '1.0.1')).toBe(false) // an older release never asks to "update"
  expect(isNewer('nightly', '1.0.1')).toBe(false)
})

const release = (
  tag: string,
  assets = [{ name: `vibes-${tag.slice(1)}.apk`, browser_download_url: `https://gh/${tag}.apk` }]
) =>
  jest.fn(async () => ({
    ok: true,
    json: async () => ({ tag_name: tag, assets })
  })) as unknown as typeof fetch

it('offers the APK of a newer release', async () => {
  const f = release('v1.2.0')
  expect(await checkForUpdate(f, '1.1.0')).toEqual({
    version: '1.2.0',
    apkUrl: 'https://gh/v1.2.0.apk'
  })
  expect((f as jest.Mock).mock.calls[0][0]).toBe(LATEST_RELEASE)
})

it('nothing when up to date, without an APK, offline or rate-limited', async () => {
  expect(await checkForUpdate(release('v1.1.0'), '1.1.0')).toBeNull()
  expect(
    await checkForUpdate(
      release('v1.2.0', [{ name: 'Vibes.AppImage', browser_download_url: 'x' }]),
      '1.1.0'
    )
  ).toBeNull()
  const offline = jest.fn(async () => {
    throw new TypeError('Network request failed')
  }) as unknown as typeof fetch
  expect(await checkForUpdate(offline, '1.1.0')).toBeNull()
  const limited = jest.fn(async () => ({
    ok: false,
    status: 403,
    json: async () => ({})
  })) as unknown as typeof fetch
  expect(await checkForUpdate(limited, '1.1.0')).toBeNull()
})
