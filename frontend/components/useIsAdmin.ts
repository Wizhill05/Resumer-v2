"use client"

import { useEffect, useState } from "react"

const ADMIN_CACHE_KEY = "resumer_is_admin"

/** True when the signed-in user passes the admin probe. Cached in
 *  sessionStorage for instant restores, re-verified in background.
 *  Keep in sync with the backend admin gate (admin emails bypass). */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(ADMIN_CACHE_KEY) === "1"
    } catch {
      return false
    }
  })

  useEffect(() => {
    fetch("/api/backend/admin/analytics")
      .then((res) => {
        const admin = res.ok
        setIsAdmin(admin)
        try {
          sessionStorage.setItem(ADMIN_CACHE_KEY, admin ? "1" : "0")
        } catch {}
      })
      .catch(() => {
        setIsAdmin(false)
        try {
          sessionStorage.setItem(ADMIN_CACHE_KEY, "0")
        } catch {}
      })
  }, [])

  return isAdmin
}
