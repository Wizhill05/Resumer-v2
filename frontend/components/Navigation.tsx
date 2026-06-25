"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid, User, History, LogOut } from "lucide-react"

export function Navigation({
  children,
  signOutAction,
}: {
  children: React.ReactNode
  signOutAction: () => Promise<void>
}) {
  const pathname = usePathname()

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutGrid },
    { name: "Profile", href: "/profile", icon: User },
    { name: "History", href: "/dashboard/history", icon: History },
  ]

  const isTabActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/generate"
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#fdfbf7] pb-20 md:pb-0">
      {/* Top Header (Desktop + Mobile) */}
      <header className="sticky top-0 z-40 bg-[#fdfbf7]/80 backdrop-blur-md border-b border-zinc-100 py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-heading text-xl font-extrabold tracking-tight text-[#ff4e26]">
            resumer.
          </Link>

          {/* Desktop Nav Items */}
          <div className="hidden md:flex items-center gap-6 text-sm font-bold text-zinc-600">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`transition-colors ${
                  isTabActive(item.href)
                    ? "text-[#ff4e26] underline decoration-2 underline-offset-4"
                    : "text-zinc-600 hover:text-black"
                }`}
              >
                {item.name}
              </Link>
            ))}
            <button
              onClick={() => signOutAction()}
              className="text-zinc-600 hover:text-black transition-colors font-bold text-sm cursor-pointer flex items-center gap-1.5"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>

          {/* Mobile Sign Out (Header) */}
          <button
            onClick={() => signOutAction()}
            className="md:hidden text-zinc-600 hover:text-black font-bold text-xs flex items-center gap-1 cursor-pointer"
          >
            <LogOut size={14} /> Out
          </button>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="flex-grow max-w-6xl mx-auto w-full px-6 py-8">
        {children}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-zinc-100 py-3 px-6 flex justify-around items-center shadow-lg shadow-zinc-900/5">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isTabActive(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center gap-1 transition-colors ${
                active ? "text-[#ff4e26]" : "text-zinc-400 hover:text-zinc-600"
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-bold tracking-tight uppercase">{item.name}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
