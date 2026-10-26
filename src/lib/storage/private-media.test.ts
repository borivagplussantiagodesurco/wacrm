import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetChatMediaUrlCache,
  parseChatMediaUrl,
  resolveChatMediaUrl,
  signChatMediaUrl,
  signTemplateHeaderParams,
} from './private-media'

const BASE = 'https://proj.supabase.co'
const pub = (p: string) => `${BASE}/storage/v1/object/public/chat-media/${p}`

function fakeClient(result: { data: { signedUrl: string } | null; error: unknown } | Error) {
  const createSignedUrl = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const from = vi.fn(() => ({ createSignedUrl }))
  return { client: { storage: { from } } as never, createSignedUrl, from }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
  __resetChatMediaUrlCache()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('parseChatMediaUrl', () => {
  it('parses a public URL', () => {
    expect(parseChatMediaUrl(pub('account-1/a.jpg'))).toEqual({
      bucket: 'chat-media',
      path: 'account-1/a.jpg',
    })
  })
  it('parses sign (ignoring token) and authenticated URLs', () => {
    expect(
      parseChatMediaUrl(`${BASE}/storage/v1/object/sign/chat-media/account-1/a.jpg?token=abc`)?.path,
    ).toBe('account-1/a.jpg')
    expect(
      parseChatMediaUrl(`${BASE}/storage/v1/object/authenticated/chat-media/account-1/a.jpg`)?.path,
    ).toBe('account-1/a.jpg')
  })
  it('decodes spaces and percent escapes', () => {
    expect(parseChatMediaUrl(pub('account-1/mi%20foto%2B1.jpg'))?.path).toBe(
      'account-1/mi foto+1.jpg',
    )
  })
  it('ignores other buckets, other domains and non-storage URLs', () => {
    expect(parseChatMediaUrl(`${BASE}/storage/v1/object/public/flow-media/a.jpg`)).toBeNull()
    expect(parseChatMediaUrl(`${BASE}/storage/v1/object/public/avatars/a.jpg`)).toBeNull()
    expect(
      parseChatMediaUrl('https://evil.example.com/storage/v1/object/public/chat-media/a.jpg'),
    ).toBeNull()
    expect(parseChatMediaUrl('/api/whatsapp/media/123')).toBeNull()
    expect(parseChatMediaUrl('not a url')).toBeNull()
    expect(parseChatMediaUrl(null)).toBeNull()
    expect(parseChatMediaUrl(`${BASE}/storage/v1/object/public/chat-media/`)).toBeNull()
  })
})

describe('signChatMediaUrl', () => {
  it('returns the signed URL', async () => {
    const { client, createSignedUrl } = fakeClient({ data: { signedUrl: 'https://signed/x' }, error: null })
    expect(await signChatMediaUrl(client, pub('account-1/a b.jpg'), 900)).toBe('https://signed/x')
    expect(createSignedUrl).toHaveBeenCalledWith('account-1/a b.jpg', 900)
  })
  it('falls back to the original URL on error, throw, or non chat-media', async () => {
    const url = pub('account-1/a.jpg')
    expect(await signChatMediaUrl(fakeClient({ data: null, error: { message: 'x' } }).client, url)).toBe(url)
    expect(await signChatMediaUrl(fakeClient(new Error('boom')).client, url)).toBe(url)
    const other = `${BASE}/storage/v1/object/public/flow-media/a.jpg`
    const f = fakeClient({ data: { signedUrl: 's' }, error: null })
    expect(await signChatMediaUrl(f.client, other)).toBe(other)
    expect(f.from).not.toHaveBeenCalled()
  })
  it('does not build the client for non chat-media URLs (factory)', async () => {
    const factory = vi.fn()
    expect(await signChatMediaUrl(factory as never, 'https://x.com/a.jpg')).toBe('https://x.com/a.jpg')
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('signTemplateHeaderParams', () => {
  it('signs the stored header URL when no explicit one is given', async () => {
    const { client } = fakeClient({ data: { signedUrl: 'https://signed/h' }, error: null })
    const out = await signTemplateHeaderParams(client, { header_media_url: pub('a/h.png') }, undefined)
    expect(out).toEqual({ headerMediaUrl: 'https://signed/h' })
  })
  it('leaves params alone for a media id or external link', async () => {
    const { client } = fakeClient({ data: { signedUrl: 's' }, error: null })
    const p = { headerMediaId: '1' }
    expect(await signTemplateHeaderParams(client, { header_media_url: pub('a/h.png') }, p)).toBe(p)
    const q = { headerMediaUrl: 'https://cdn.example.com/x.png' }
    expect(await signTemplateHeaderParams(client, null, q)).toBe(q)
  })
})

describe('resolveChatMediaUrl', () => {
  it('caches until expiry and dedupes in-flight calls', async () => {
    vi.useFakeTimers()
    const { client, createSignedUrl } = fakeClient({ data: { signedUrl: 'https://signed/1' }, error: null })
    const url = pub('a/b.jpg')
    const [a, b] = await Promise.all([
      resolveChatMediaUrl(client, url),
      resolveChatMediaUrl(client, url),
    ])
    expect(a).toBe('https://signed/1')
    expect(b).toBe('https://signed/1')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    await resolveChatMediaUrl(client, url)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3600 * 1000)
    await resolveChatMediaUrl(client, url)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })
  it('falls back to the original URL and does not cache failures', async () => {
    const url = pub('a/b.jpg')
    const f = fakeClient({ data: null, error: { message: 'nope' } })
    expect(await resolveChatMediaUrl(f.client, url)).toBe(url)
    expect(await resolveChatMediaUrl(f.client, url)).toBe(url)
    expect(f.createSignedUrl).toHaveBeenCalledTimes(2)
    expect(await resolveChatMediaUrl(f.client, 'https://x.com/a.png')).toBe('https://x.com/a.png')
  })
})
