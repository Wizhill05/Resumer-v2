import { SupportShell } from "@/components/support/SupportShell"
import { IssueThread } from "@/components/support/IssueThread"
export const metadata = {
  title: "Support issue | Résumer",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
}
export default async function SupportIssuePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ access_token?: string | string[]; admin?: string }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  return (
    <SupportShell>
      <IssueThread
        key={`${id}-${query.access_token || "account"}`}
        id={id}
        adminView={query.admin === "1"}
        accessToken={typeof query.access_token === "string" ? query.access_token : undefined}
      />
    </SupportShell>
  )
}
