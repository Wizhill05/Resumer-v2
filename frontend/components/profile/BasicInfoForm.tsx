"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"

const schema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedin_url: z.string().url("Invalid URL").or(z.literal("")),
  github_url: z.string().url("Invalid URL").or(z.literal("")),
  portfolio_url: z.string().url("Invalid URL").or(z.literal("")),
  subtitle: z.string().optional(),
  summary: z.string().optional(),
  skills: z.string().optional(), // Raw comma-separated string for editing
})

type FormData = z.infer<typeof schema>

export function BasicInfoForm() {
  const queryClient = useQueryClient()

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/backend/profile")
      if (!res.ok) throw new Error("Failed to load profile")
      return res.json()
    },
  })

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: profile ? {
      full_name: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      linkedin_url: profile.linkedin_url || "",
      github_url: profile.github_url || "",
      portfolio_url: profile.portfolio_url || "",
      subtitle: profile.subtitle || "",
      summary: profile.summary || "",
      skills: profile.skills ? profile.skills.join(", ") : "",
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const skillsArray = data.skills
        ? data.skills.split(",").map((s) => s.trim()).filter(Boolean)
        : []

      const res = await fetch("/api/backend/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          skills: skillsArray,
        }),
      })
      if (!res.ok) throw new Error("Failed to update profile")
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] })
    },
  })

  const onSubmit = (data: FormData) => {
    mutation.mutate(data)
  }

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="flex gap-2">
          <span className="loading-dot bg-[#ff4e26]" />
          <span className="loading-dot bg-yellow-400" />
          <span className="loading-dot bg-[#ff4e26]" />
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pixel-enter">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name</Label>
          <Input id="full_name" {...register("full_name")} />
          {errors.full_name && <p className="text-red-600 text-xs font-bold">{errors.full_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="subtitle">Subtitle / Headline</Label>
          <Input id="subtitle" placeholder="e.g. Final Year Undergraduate" {...register("subtitle")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && <p className="text-red-600 text-xs font-bold">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" placeholder="e.g. San Francisco, CA" {...register("location")} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="linkedin_url">LinkedIn URL</Label>
          <Input id="linkedin_url" {...register("linkedin_url")} />
          {errors.linkedin_url && <p className="text-red-600 text-xs font-bold">{errors.linkedin_url.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="github_url">GitHub URL</Label>
          <Input id="github_url" {...register("github_url")} />
          {errors.github_url && <p className="text-red-600 text-xs font-bold">{errors.github_url.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="portfolio_url">Portfolio URL</Label>
          <Input id="portfolio_url" {...register("portfolio_url")} />
          {errors.portfolio_url && <p className="text-red-600 text-xs font-bold">{errors.portfolio_url.message}</p>}
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="skills">Skills (comma separated)</Label>
          <Input id="skills" placeholder="React, Node.js, Python" {...register("skills")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="summary">Professional Summary</Label>
        <Textarea id="summary" rows={4} {...register("summary")} />
      </div>

      <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
        {mutation.isPending ? <><Loader2 className="animate-spin" size={16} /> Saving...</> : "Save Changes"}
      </Button>
    </form>
  )
}
