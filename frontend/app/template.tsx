export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-enter flex-1 min-h-0 flex flex-col">{children}</div>
}
