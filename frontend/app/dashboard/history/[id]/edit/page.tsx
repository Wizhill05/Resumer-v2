import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { EditorClient } from "./EditorClient"
import { signBackendToken } from "@/lib/jwt"
import type { EditorPayload } from "@/lib/resume-schema"

type Props = {
  params: Promise<{ id: string }>
}

async function fetchEditorPayload(genId: string): Promise<EditorPayload | null> {
  const session = await auth()
  if (!session?.user) return null

  const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000"
  const token = await signBackendToken({
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    picture: session.user.image ?? "",
    provider: (session.user as { provider?: string }).provider ?? "google",
  })

  const res = await fetch(`${backendUrl}/generate/${genId}/editor`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })

  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) throw new Error(`Editor fetch failed: ${res.status}`)
  return res.json()
}

export default async function EditorPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/")

  const payload = await fetchEditorPayload(id)
  if (!payload) notFound()

  return <EditorClient payload={payload} />
}
