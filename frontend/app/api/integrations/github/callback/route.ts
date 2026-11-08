import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { backendTokenForSession } from "@/lib/jwt";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
const COOKIE_NAME = "gh_link";

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function withGithubParams(returnTo: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return returnTo.includes("?") ? `${returnTo}&${qs}` : `${returnTo}?${qs}`;
}

type CookiePayload = { s?: string; r?: string };

function parseCookie(raw: string | undefined): CookiePayload | null {
  if (!raw) return null;
  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch {
    // Fall through with the raw value only.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as CookiePayload;
      if (typeof parsed.s === "string") return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const rawCookie = req.cookies.get(COOKIE_NAME)?.value;
  const cookie = parseCookie(rawCookie);
  const returnTo =
    cookie?.r && cookie.r.startsWith("/") && !cookie.r.startsWith("//")
      ? cookie.r
      : "/account";

  const redirectTo = (params: Record<string, string>) => {
    const response = NextResponse.redirect(new URL(withGithubParams(returnTo, params), req.url), 302);
    response.cookies.delete(COOKIE_NAME);
    return response;
  };

  if (!cookie || !state || sha256hex(state) !== cookie.s) {
    return redirectTo({ github: "error", reason: "expired" });
  }

  if (error === "access_denied") {
    return redirectTo({ github: "error", reason: "denied" });
  }

  if (!code) {
    return redirectTo({ github: "error", reason: "failed" });
  }

  const session = await auth();
  if (!session || !session.user?.email) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  try {
    const backendToken = await backendTokenForSession(session);
    const backendRes = await fetch(`${BACKEND_URL}/integrations/github/link/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
      body: JSON.stringify({ code, state }),
      cache: "no-store",
    });
    if (backendRes.ok) {
      return redirectTo({ github: "connected" });
    }
    let detail = "failed";
    try {
      const body = (await backendRes.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
    } catch {
      // Keep the default reason.
    }
    return redirectTo({ github: "error", reason: detail });
  } catch {
    return redirectTo({ github: "error", reason: "failed" });
  }
}
