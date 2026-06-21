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

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    values: profile ? {
      full_name: profile.full_name || "",
      email: profile.email || "",
      phone: profile.phone || "",
      location: profile.location || "",
      linkedin_url: profile.linkedin_url || "",
      github_url: profile.github_url || "",
      portfolio_url: profile.portfolio_url || "",
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
        <Loader2 className="animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name</Label>
          <Input id="full_name" {...register("full_name")} className="bg-zinc-900 border-zinc-800 text-white" />
          {errors.full_name && <p className="text-red-400 text-xs">{errors.full_name.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} className="bg-zinc-900 border-zinc-800 text-white" />
          {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} className="bg-zinc-900 border-zinc-800 text-white" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" placeholder="e.g. San Francisco, CA" {...register("location")} className="bg-zinc-900 border-zinc-800 text-white" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="linkedin_url">LinkedIn URL</Label>
          <Input id="linkedin_url" {...register("linkedin_url")} className="bg-zinc-900 border-zinc-800 text-white" />
          {errors.linkedin_url && <p className="text-red-400 text-xs">{errors.linkedin_url.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="github_url">GitHub URL</Label>
          <Input id="github_url" {...register("github_url")} className="bg-zinc-900 border-zinc-800 text-white" />
          {errors.github_url && <p className="text-red-400 text-xs">{errors.github_url.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="portfolio_url">Portfolio URL</Label>
          <Input id="portfolio_url" {...register("portfolio_url")} className="bg-zinc-900 border-zinc-800 text-white" />
          {errors.portfolio_url && <p className="text-red-400 text-xs">{errors.portfolio_url.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="skills">Skills (comma separated)</Label>
          <Input id="skills" placeholder="React, Node.js, Python" {...register("skills")} className="bg-zinc-900 border-zinc-800 text-white" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="summary">Professional Summary</Label>
        <Textarea id="summary" rows={4} {...register("summary")} className="bg-zinc-900 border-zinc-800 text-white" />
      </div>

      <Button type="submit" disabled={mutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
        {mutation.isPending ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  )
}
