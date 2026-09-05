import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { RemakeClient } from "./RemakeClient"

type Props = {
  params: Promise<{ id: string }>
}

export default async function RemakePage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/")

  return <RemakeClient runId={id} />
}
