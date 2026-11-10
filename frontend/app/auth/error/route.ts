import { NextRequest, NextResponse } from "next/server"
import { AUTH_RETURN_COOKIE } from "@/lib/auth-errors"
import { safeReturnTo } from "@/lib/safe-return-to"

// Every failed sign-in lands here: our signIn callback's own errors
// (?auth_error=...) and Auth.js errors such as a cancelled OAuth consent
// (?error=...). Send the user back to the page they started from, e.g. /try,
// so a guest keeps their in-progress résumé instead of landing on /.
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const authError = params.get("auth_error") || (params.get("error") ? "sign_in_failed" : null)
  const provider = params.get("provider")

  const returnTo = safeReturnTo(request.cookies.get(AUTH_RETURN_COOKIE)?.value, request.url, "/")

  const target = new URL(returnTo, request.nextUrl.origin)
  if (authError) target.searchParams.set("auth_error", authError)
  if (provider) target.searchParams.set("provider", provider)

  const response = NextResponse.redirect(target)
  response.cookies.delete(AUTH_RETURN_COOKIE)
  return response
}
