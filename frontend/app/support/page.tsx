import { auth } from "@/lib/auth"
import { SupportShell } from "@/components/support/SupportShell"
import { SupportInbox } from "@/components/support/SupportInbox"
import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
export default async function SupportPage() {
  const session = await auth()
  return (
    <SupportShell
      signedIn={Boolean(session?.user)}
      title="Support"
      subtitle="Report a problem, share an idea, or follow up. Every issue is a private conversation."
      actions={
        <Link href="/support/new">
          <Button size="lg">
            <Plus size={16} aria-hidden="true" />
            New issue
          </Button>
        </Link>
      }
    >
      <SupportInbox signedIn={Boolean(session?.user)} />
    </SupportShell>
  )
}
