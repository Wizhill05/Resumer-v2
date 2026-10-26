import { auth } from "@/lib/auth"
import { SupportShell } from "@/components/support/SupportShell"
import { SupportInbox } from "@/components/support/SupportInbox"
export default async function SupportPage() {
  const session = await auth()
  return (
    <SupportShell>
      <SupportInbox signedIn={Boolean(session?.user)} />
    </SupportShell>
  )
}
