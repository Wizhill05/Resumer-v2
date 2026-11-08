"use client"

import { useState } from "react"
import { signInGithub, signInGoogle } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { EmailAuthForm } from "@/components/EmailAuthForm"
import { FluidField } from "@/components/landing/FluidField"

interface OAuthAuthorizeClientProps {
  clientName: string
  callbackUrl: string
}

export function OAuthAuthorizeClient({ clientName, callbackUrl }: OAuthAuthorizeClientProps) {
  const [showEmail, setShowEmail] = useState(false)

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-4 text-ink">
      <FluidField sheen={false} />
      <div className="relative w-full max-w-md rounded-lg border border-line bg-paper/85 p-6 shadow-soft-lg backdrop-blur-xl sm:p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-[-0.03em] md:text-3xl">
            Connect to Résumer
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to grant <span className="font-semibold text-ember">{clientName}</span> access to your tailored résumés and profile.
          </p>
        </div>

        {/* Action Buttons */}
        {!showEmail ? (
          <>
            <div className="space-y-3">
              <form action={signInGoogle}>
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <Button
                  type="submit"
                  className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-md border border-line bg-paper py-6 text-sm font-semibold text-ink shadow-soft transition-colors hover:border-ember/50 hover:bg-paper"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Continue with Google
                </Button>
              </form>

              <form action={signInGithub}>
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <Button
                  type="submit"
                  className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-md border border-transparent bg-ink py-6 text-sm font-semibold text-paper shadow-soft transition-colors hover:bg-ink/90"
                >
                  <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    />
                  </svg>
                  Continue with GitHub
                </Button>
              </form>
            </div>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setShowEmail(true)}
                className="cursor-pointer text-xs font-semibold text-ink-muted underline underline-offset-4 transition-colors hover:text-ember"
              >
                Use email instead
              </button>
            </div>
          </>
        ) : (
          <EmailAuthForm
            callbackUrl={callbackUrl}
            onBack={() => setShowEmail(false)}
          />
        )}

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-ink-muted">
          Your credentials and résumés remain private and secure.
        </p>
      </div>
    </div>
  )
}

