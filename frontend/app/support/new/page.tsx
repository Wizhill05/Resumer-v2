import { auth } from "@/lib/auth"
import { SupportShell } from "@/components/support/SupportShell"
import { SupportClient } from "../SupportClient"
export default async function NewSupportIssue({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const [session, query] = await Promise.all([auth(), searchParams])
  const text = (key: string) => (typeof query[key] === "string" ? query[key] : undefined)
  return (
    <SupportShell>
      <SupportClient
        userEmail={session?.user?.email ?? undefined}
        signedIn={Boolean(session?.user)}
        initialCategory={text("category")}
        initialMessage={text("message")}
        generationId={text("generation_id")}
        initialLocation={text("where_happened")}
      />
    </SupportShell>
  )
}
