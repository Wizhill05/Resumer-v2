export type GuestProfile = {
  full_name?: string | null
  email?: string | null
  phone?: string | null
  location?: string | null
  linkedin_url?: string | null
  github_url?: string | null
  portfolio_url?: string | null
  subtitle?: string | null
  summary?: string | null
  skills?: string[] | null
}

export type GuestExperience = {
  role: string
  organization: string
  location?: string | null
  start_date?: string | null
  end_date?: string | null
  bullet_points?: string[] | null
  sort_order?: number
}

export type GuestProject = {
  name: string
  description?: string | null
  technologies?: string[] | null
  github_url?: string | null
  live_url?: string | null
  start_date?: string | null
  end_date?: string | null
  bullet_points?: string[] | null
  sort_order?: number
}

export type GuestEducation = {
  degree: string
  institution: string
  location?: string | null
  start_date?: string | null
  end_date?: string | null
  gpa?: string | null
  coursework?: string[] | null
  sort_order?: number
}

export type GuestExtracurricular = {
  title: string
  organization?: string | null
  description?: string | null
  start_date?: string | null
  end_date?: string | null
  bullet_points?: string[] | null
  sort_order?: number
}

export type GuestDraft = {
  profile: GuestProfile
  experiences: GuestExperience[]
  projects: GuestProject[]
  education: GuestEducation[]
  extracurriculars: GuestExtracurricular[]
  updatedAt: string
}
