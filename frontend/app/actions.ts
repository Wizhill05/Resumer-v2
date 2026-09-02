"use server"

import { signIn, signOut } from "@/lib/auth"

function callbackUrl(formData?: FormData) {
  const raw = formData?.get("callbackUrl")
  return typeof raw === "string" && raw.startsWith("/") ? raw : "/dashboard"
}

export async function signInGithub(formData?: FormData) {
  await signIn("github", { redirectTo: callbackUrl(formData) })
}

export async function signInGoogle(formData?: FormData) {
  await signIn("google", { redirectTo: callbackUrl(formData) })
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" })
}
