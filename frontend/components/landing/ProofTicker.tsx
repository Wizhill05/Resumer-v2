const TICKER_ITEMS = [
  "NO POPUP REQUIRED",
  "5 FREE GENERATIONS / DAY",
  "GREENHOUSE & LEVER READY",
  "IMPACT-DRIVEN REWRITES",
  "1-CLICK PDF EXPORT",
  "ZERO CORPORATE FLUFF",
  "GITHUB & GOOGLE OAUTH",
  "NO PASSWORD HEADACHES",
]

export function ProofTicker() {
  return (
    <div className="relative w-full overflow-hidden border-y-2 border-black dark:border-zinc-800 bg-zinc-950 py-3.5 text-white">
      <div className="flex w-max animate-[landing-marquee_26s_linear_infinite] items-center whitespace-nowrap">
        {/* Render twice for seamless loop */}
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, idx) => (
          <div key={idx} className="flex items-center gap-4 px-4">
            <span className="text-xs font-black uppercase tracking-widest text-zinc-200">
              {item}
            </span>
            <span className="text-[#ff4e26] font-black text-sm">/</span>
          </div>
        ))}
      </div>
    </div>
  )
}
