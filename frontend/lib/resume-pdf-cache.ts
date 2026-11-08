/**
 * On-device cache of generated résumé PDFs.
 *
 * Opening the history preview fetches the full PDF; this keeps that copy in
 * Cache Storage so a later download is instant and works without another
 * round trip. Entries are keyed by run id *and* `pdf_version` (the backend's
 * editor revision), so an edit made anywhere makes the old copy unreachable;
 * the editor also drops the run's entries as soon as a save succeeds.
 *
 * Falls back to an in-memory map where Cache Storage is unavailable
 * (non-secure contexts, some private-browsing modes).
 */

const CACHE_NAME = "resumer-resume-pdfs-v1"
const KEY_PREFIX = "/__resume-pdf/"
const MAX_ENTRIES = 24

export type ResumePdf = { blob: Blob; filename: string }

const memory = new Map<string, ResumePdf>()
const inflight = new Map<string, Promise<ResumePdf>>()

function keyFor(runId: string, version: number) {
  return `${KEY_PREFIX}${runId}/v${version}`
}

function keyUrl(key: string) {
  return new URL(key, window.location.origin).toString()
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

function filenameFrom(disposition: string | null, fallback: string) {
  if (!disposition) return fallback
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""))
    } catch {
      /* fall through to the plain filename */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1].trim() : fallback
}

async function readCached(key: string): Promise<ResumePdf | null> {
  const hit = memory.get(key)
  if (hit) return hit
  const cache = await openCache()
  const res = await cache?.match(keyUrl(key))
  if (!res) return null
  const pdf = {
    blob: await res.blob(),
    filename: decodeURIComponent(res.headers.get("x-filename") || "resume.pdf"),
  }
  memory.set(key, pdf)
  return pdf
}

async function writeCached(runId: string, key: string, pdf: ResumePdf) {
  memory.set(key, pdf)
  const cache = await openCache()
  if (!cache) return
  try {
    // Older versions of this run are stale by definition.
    const keys = await cache.keys()
    const runPrefix = keyUrl(`${KEY_PREFIX}${runId}/`)
    await Promise.all(
      keys.filter((req) => req.url.startsWith(runPrefix)).map((req) => cache.delete(req))
    )
    await cache.put(
      keyUrl(key),
      new Response(pdf.blob, {
        headers: {
          "content-type": "application/pdf",
          "x-filename": encodeURIComponent(pdf.filename),
        },
      })
    )
    // Cache.keys() returns insertion order; drop the oldest beyond the cap.
    const all = await cache.keys()
    await Promise.all(all.slice(0, Math.max(0, all.length - MAX_ENTRIES)).map((req) => cache.delete(req)))
  } catch {
    // Quota or private-mode failures only cost us the cache, not the preview.
  }
}

async function fetchPdf(runId: string, signal?: AbortSignal): Promise<ResumePdf> {
  const res = await fetch(`/api/backend/generate/${runId}/download`, { signal, cache: "no-store" })
  if (!res.ok) throw new Error(res.status === 404 ? "This résumé is no longer available" : `Could not load the PDF (HTTP ${res.status})`)
  const blob = await res.blob()
  if (!blob.size) throw new Error("The PDF came back empty")
  return {
    blob: blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }),
    filename: filenameFrom(res.headers.get("content-disposition"), "resume.pdf"),
  }
}

/** Cached PDF for this run version, fetching (and caching) it on a miss. */
export function getResumePdf(runId: string, version = 0): Promise<ResumePdf> {
  const key = keyFor(runId, version)
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async () => {
    const cached = await readCached(key)
    if (cached) return cached
    const pdf = await fetchPdf(runId)
    await writeCached(runId, key, pdf)
    return pdf
  })().finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

/** Cached copy only; never hits the network. */
export async function peekResumePdf(runId: string, version = 0): Promise<ResumePdf | null> {
  const key = keyFor(runId, version)
  return (await readCached(key)) ?? (inflight.has(key) ? inflight.get(key)!.catch(() => null) : null)
}

export function saveBlob({ blob, filename }: ResumePdf) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Download a run's PDF: straight from the device cache when the preview
 * already fetched it, otherwise through the normal download endpoint.
 */
export async function downloadResumePdf(runId: string, version = 0) {
  const cached = await peekResumePdf(runId, version).catch(() => null)
  if (cached) {
    saveBlob(cached)
    return
  }
  window.location.href = `/api/backend/generate/${runId}/download`
}

/** Drop every cached version of a run (after an edit or delete). */
export async function forgetResumePdf(runId: string) {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(`${KEY_PREFIX}${runId}/`)) memory.delete(key)
  }
  const cache = await openCache()
  if (!cache) return
  const runPrefix = keyUrl(`${KEY_PREFIX}${runId}/`)
  const keys = await cache.keys()
  await Promise.all(keys.filter((req) => req.url.startsWith(runPrefix)).map((req) => cache.delete(req)))
}

/** Remove all cached résumés from this device (on sign-out). */
export async function clearResumePdfCache() {
  memory.clear()
  try {
    if (typeof caches !== "undefined") await caches.delete(CACHE_NAME)
  } catch {
    /* nothing cached */
  }
}
