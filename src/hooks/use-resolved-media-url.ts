"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  parseChatMediaUrl,
  resolveChatMediaUrl,
} from "@/lib/storage/private-media";

/**
 * Resolve a canonical `chat-media` URL (as stored in the database) into a
 * short-lived signed URL, so it renders from a private bucket.
 *
 * - Anything that is not chat-media (proxy URLs, other buckets, external
 *   links) is returned synchronously and untouched.
 * - For chat-media the value is `null` until the signature resolves (never
 *   the unsigned URL, which a private bucket would 400). If signing fails
 *   the resolver falls back to the original URL, so a still-public bucket
 *   keeps working.
 * - Use the plain URL for streaming elements (`<video>`, `<audio>`, `<a>`):
 *   the signed URL is a normal https URL, so they stream as before.
 */
export function useResolvedMediaUrl(url: string | undefined | null): string | null {
  const isChatMedia = !!url && parseChatMediaUrl(url) !== null;
  const [resolved, setResolved] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    if (!url || !isChatMedia) return;
    let cancelled = false;
    resolveChatMediaUrl(createClient(), url).then((to) => {
      if (!cancelled) setResolved({ from: url, to });
    });
    return () => {
      cancelled = true;
    };
  }, [url, isChatMedia]);

  if (!url) return null;
  if (!isChatMedia) return url;
  return resolved?.from === url ? resolved.to : null;
}
