import { FileText, GraduationCap, Code, FolderGit2, Briefcase, Award } from "lucide-react"
import type { SectionId } from "@/lib/template-layout"

const icons = { summary: FileText, education: GraduationCap, skills: Code, projects: FolderGit2, experiences: Briefcase, extracurriculars: Award }

export function SectionIcon({ section, size = 16 }: { section: SectionId; size?: number }) {
  const Icon = icons[section]
  return <Icon size={size} aria-hidden="true" />
}
