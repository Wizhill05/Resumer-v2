export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-enter flex-1 flex flex-col">{children}</div>
}
