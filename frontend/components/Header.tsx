"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"

export function Header({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [isOpen, setIsOpen] = useState(false)

  const menuItems = [
    { name: "How it Works", href: "#how-it-works" },
    { name: "Templates", href: "#templates" },
    { name: "Pricing", href: "#pricing" },
    { name: "Privacy", href: "#privacy" },
    ...(isLoggedIn ? [{ name: "Dashboard", href: "/dashboard" }] : []),
  ]

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#fdfbf7]/80 backdrop-blur-md border-b border-zinc-100 py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-heading text-xl font-extrabold tracking-tight text-[#ff4e26]">
            resumer.
          </Link>
          
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-bold text-zinc-600">
            {menuItems.map((item) => (
              <Link key={item.name} href={item.href} className="hover:text-black transition-colors">
                {item.name}
              </Link>
            ))}
          </nav>

          {/* Hamburger Trigger */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-zinc-950 hover:text-black focus:outline-none"
            aria-label="Toggle Menu"
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Hamburger Sheet Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-[#fdfbf7] flex flex-col justify-between p-8 pt-24 animate-in fade-in slide-in-from-top-5 duration-300">
          <nav className="flex flex-col gap-6 text-2xl font-heading font-extrabold text-zinc-900 mt-8">
            {menuItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="hover:text-[#ff4e26] transition-colors py-2 border-b border-zinc-100"
              >
                {item.name}
              </Link>
            ))}
            {!isLoggedIn && (
              <div className="pt-4 text-sm font-medium text-zinc-500">
                Sign in on the main page to tailor your resume.
              </div>
            )}
          </nav>

          <div className="text-xs font-bold text-zinc-400 text-center tracking-widest uppercase">
            © resumer. all rights reserved.
          </div>
        </div>
      )}
    </>
  )
}
