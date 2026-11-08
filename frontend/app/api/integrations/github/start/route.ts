import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { backendTokenForSession } from "@/lib/jwt";
import { safeReturnTo } from "@/lib/safe-return-to";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
const COOKIE_NAME = "gh_link";

function validReturnTo(value: string | null, requestUrl: string): string {
  return safeReturnTo(value, requestUrl);
}

function withGithubParams(returnTo: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return returnTo.includes("?") ? `${returnTo}&${qs}` : `${returnTo}?${qs}`;
}

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const searchParams = req.nextUrl.searchParams;
  const wantPrivate = searchParams.get("private") === "1";
  const returnTo = validReturnTo(searchParams.get("returnTo"), req.url);

  let state = "";
  let authorizeUrl = "";
  try {
    const backendToken = await backendTokenForSession(session);
    const backendRes = await fetch(`${BACKEND_URL}/integrations/github/link/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
      body: JSON.stringify({ private: wantPrivate }),
      cache: "no-store",
    });
    if (!backendRes.ok) {
      throw new Error("Backend rejected link start");
    }
    const data = (await backendRes.json()) as { state?: string; authorize_url?: string };
    if (!data.state || !data.authorize_url) {
      throw new Error("Backend returned an incomplete link start");
    }
    state = data.state;
    authorizeUrl = data.authorize_url;
  } catch {
    return NextResponse.redirect(
      new URL(withGithubParams(returnTo, { github: "error", reason: "failed" }), req.url),
      302,
    );
  }

  const reqUrl = new URL(req.url);
  const isLocal =
    reqUrl.protocol === "http:" &&
    (reqUrl.hostname === "localhost" || reqUrl.hostname === "127.0.0.1");

  const response = NextResponse.redirect(new URL(authorizeUrl), 302);
  response.cookies.set(COOKIE_NAME, JSON.stringify({ s: sha256hex(state), r: returnTo }), {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax",
    path: "/api/integrations/github",
    maxAge: 600,
  });
  return response;
}
