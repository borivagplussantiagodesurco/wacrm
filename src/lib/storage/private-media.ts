import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Private `chat-media` support.
 *
 * The canonical URL stored in the database (`messages.media_url`,
 * `message_templates.header_media_url`, flow node configs…) is ALWAYS the
 * public-format string `${SUPABASE_URL}/storage/v1/object/public/chat-media/<path>`
 * — `getPublicUrl` keeps returning it even once the bucket is private.
 * What changes is that, when we DISPLAY or SEND it, that canonical URL is
 * resolved into a short-lived signed URL:
 *
 *   - browser: `resolveChatMediaUrl` (user session, cached in memory)
 *   - server → Meta: `signChatMediaUrl` (service role, ~15 min)
 *
 * Both fall back to the original URL on any failure, so everything keeps
 * working while the bucket is still public.
 */

export const CHAT_MEDIA_BUCKET = 'chat-media'

const STORAGE_SEGMENT = '/storage/v1/object/'
const ACCESS_MODES = ['public', 'sign', 'authenticated'] as const

function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/**
 * Extract `{ bucket, path }` from a Supabase Storage URL that points at the
 * `chat-media` bucket of THIS project. Accepts the `public`, `sign`
 * (query/token ignored) and `authenticated` object segments. Returns null
 * for other buckets, other domains, the `/api/whatsapp/media/*` proxy, or
 * anything unparseable.
 */
export function parseChatMediaUrl(
  url: string | null | undefined,
): { bucket: typeof CHAT_MEDIA_BUCKET; path: string } | null {
  if (!url || typeof url !== 'string') return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null

  const origin = supabaseOrigin()
  if (origin && u.origin !== origin) return null

  if (!u.pathname.startsWith(STORAGE_SEGMENT)) return null
  const rest = u.pathname.slice(STORAGE_SEGMENT.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const mode = rest.slice(0, slash)
  if (!(ACCESS_MODES as readonly string[]).includes(mode)) return null
  const afterMode = rest.slice(slash + 1)
  const slash2 = afterMode.indexOf('/')
  if (slash2 <= 0) return null
  const bucket = afterMode.slice(0, slash2)
  if (bucket !== CHAT_MEDIA_BUCKET) return null

  let path: string
  try {
    path = decodeURIComponent(afterMode.slice(slash2 + 1))
  } catch {
    return null
  }
  if (!path) return null
  return { bucket: CHAT_MEDIA_BUCKET, path }
}

type AdminLike = SupabaseClient | (() => SupabaseClient)

/**
 * SERVER. Sign a chat-media URL with the service-role client so Meta (or
 * any server-side fetch) can read it from a private bucket. Returns the
 * original URL when it isn't chat-media or signing fails. Never throws.
 * `admin` may be a factory so no client is built for non-chat-media URLs.
 */
export async function signChatMediaUrl(
  admin: AdminLike,
  url: string,
  ttlSeconds = 900,
): Promise<string> {
  const parsed = parseChatMediaUrl(url)
  if (!parsed) return url
  try {
    const client = typeof admin === 'function' ? admin() : admin
    const { data, error } = await client.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, ttlSeconds)
    if (error || !data?.signedUrl) return url
    return data.signedUrl
  } catch {
    return url
  }
}

/**
 * SERVER. For a template send, sign the media-header link (explicit
 * `headerMediaUrl` or the template's stored `header_media_url`) right
 * before handing it to Meta. Returns messageParams untouched when there
 * is nothing to sign. The signed URL is never persisted.
 */
export async function signTemplateHeaderParams<
  P extends { headerMediaUrl?: string; headerMediaId?: string },
>(
  admin: AdminLike,
  template: { header_media_url?: string | null } | null | undefined,
  messageParams: P | null | undefined,
): Promise<P | undefined> {
  if (messageParams?.headerMediaId) return messageParams ?? undefined
  const link = messageParams?.headerMediaUrl ?? template?.header_media_url
  if (!link || !parseChatMediaUrl(link)) return messageParams ?? undefined
  const signed = await signChatMediaUrl(admin, link)
  if (signed === link) return messageParams ?? undefined
  return { ...(messageParams ?? ({} as P)), headerMediaUrl: signed }
}

// ---------------------------------------------------------------------
// CLIENT
// ---------------------------------------------------------------------

interface CacheEntry {
  url: string
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<string>>()

/** Refresh slightly before the real expiry so a URL never dies mid-use. */
const SAFETY_MARGIN_MS = 60_000

/**
 * BROWSER. Resolve a canonical chat-media URL into a signed one using the
 * user's session. Cached in memory until just before expiry; concurrent
 * callers share one request. Falls back to the original URL.
 */
export async function resolveChatMediaUrl(
  supabase: Pick<SupabaseClient, 'storage'>,
  url: string,
  ttlSeconds = 3600,
): Promise<string> {
  const parsed = parseChatMediaUrl(url)
  if (!parsed) return url

  const hit = cache.get(url)
  if (hit && hit.expiresAt - SAFETY_MARGIN_MS > Date.now()) return hit.url

  const pending = inFlight.get(url)
  if (pending) return pending

  const load = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from(parsed.bucket)
        .createSignedUrl(parsed.path, ttlSeconds)
      if (error || !data?.signedUrl) return url
      cache.set(url, {
        url: data.signedUrl,
        expiresAt: Date.now() + ttlSeconds * 1000,
      })
      return data.signedUrl
    } catch {
      return url
    }
  })()

  inFlight.set(url, load)
  try {
    return await load
  } finally {
    inFlight.delete(url)
  }
}

/** Test seam. */
export function __resetChatMediaUrlCache(): void {
  cache.clear()
  inFlight.clear()
}
