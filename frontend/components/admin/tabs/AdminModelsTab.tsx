"use client"

import React, { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Zap,
  Save,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { ModelSettingsResponse } from "../types"

const PRO_MODEL_PRESETS = [
  {
    name: "OmniRoute — Gemini 3.7 Flash Tiered (Recommended)",
    baseUrl: "https://omniroute-latest-rmm0.onrender.com/",
    model: "antigravity/gemini-3.7-flash-tiered",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Anthropic Claude 3.5 Sonnet",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-3.5-sonnet",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — OpenAI GPT-4o",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — DeepSeek V3 (Chat)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Google Gemini 2.0 Flash",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-001",
    fallbackModel: "gemma-4-31b-it",
  },
]

const FREE_MODEL_PRESETS = [
  {
    name: "OpenRouter — Poolside Laguna XS 2.1 (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "poolside/laguna-xs-2.1:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Meta Llama 3.3 70B Instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — DeepSeek R1 Distill Llama 70B (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-r1-distill-llama-70b:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Google Gemini 2.0 Flash Exp (Free)",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-exp:free",
    fallbackModel: "gemma-4-31b-it",
  },
  {
    name: "OpenRouter — Qwen 2.5 72B Instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen-2.5-72b-instruct",
    fallbackModel: "gemma-4-31b-it",
  },
]

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function AdminModelsTab() {
  const queryClient = useQueryClient()

  // Query Settings
  const { data: modelSettings } = useQuery<ModelSettingsResponse>({
    queryKey: ["admin-model-settings"],
    queryFn: () => fetchJson<ModelSettingsResponse>("/api/backend/admin/model-settings"),
  })

  // Pro Tier local overrides
  const [proBaseUrlOverride, setProBaseUrl] = useState<string | null>(null)
  const [proModelOverride, setProModel] = useState<string | null>(null)
  const [proTempOverride, setProTemp] = useState<number | null>(null)
  const [proFallbackProviderOverride, setProFallbackProvider] = useState<string | null>(null)
  const [proFallbackModelOverride, setProFallbackModel] = useState<string | null>(null)

  // Free Tier local overrides
  const [freeBaseUrlOverride, setFreeBaseUrl] = useState<string | null>(null)
  const [freeModelOverride, setFreeModel] = useState<string | null>(null)
  const [freeTempOverride, setFreeTemp] = useState<number | null>(null)
  const [freeFallbackProviderOverride, setFreeFallbackProvider] = useState<string | null>(null)
  const [freeFallbackModelOverride, setFreeFallbackModel] = useState<string | null>(null)

  // Derived effective values
  const proBaseUrl = proBaseUrlOverride ?? modelSettings?.pro?.base_url ?? ""
  const proModel = proModelOverride ?? modelSettings?.pro?.model ?? ""
  const proTemp = proTempOverride ?? (typeof modelSettings?.pro?.temperature === "number" ? modelSettings.pro.temperature : 0.2)
  const proFallbackProvider = proFallbackProviderOverride ?? modelSettings?.pro?.fallback_provider ?? "google"
  const proFallbackModel = proFallbackModelOverride ?? modelSettings?.pro?.fallback_model ?? "gemma-4-31b-it"

  const freeBaseUrl = freeBaseUrlOverride ?? modelSettings?.free?.base_url ?? ""
  const freeModel = freeModelOverride ?? modelSettings?.free?.model ?? ""
  const freeTemp = freeTempOverride ?? (typeof modelSettings?.free?.temperature === "number" ? modelSettings.free.temperature : 0.2)
  const freeFallbackProvider = freeFallbackProviderOverride ?? modelSettings?.free?.fallback_provider ?? "google"
  const freeFallbackModel = freeFallbackModelOverride ?? modelSettings?.free?.fallback_model ?? "gemma-4-31b-it"

  // Test state
  const [testResult, setTestResult] = useState<{
    tier: string
    success: boolean
    output?: string
    latency_ms?: number
    error?: string
  } | null>(null)

  // Save Pro mutation
  const saveProMutation = useMutation({
    mutationFn: async () => {
      return fetchJson("/api/backend/admin/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: "pro",
          base_url: proBaseUrl,
          model: proModel,
          temperature: proTemp,
          fallback_provider: proFallbackProvider,
          fallback_model: proFallbackModel,
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-model-settings"] })
      queryClient.invalidateQueries({ queryKey: ["admin-analytics"] })
      alert("Pro tier configuration updated successfully!")
    },
    onError: (err: Error) => {
      alert(`Save failed: ${err.message}`)
    },
  })

  // Save Free mutation
  const saveFreeMutation = useMutation({
    mutationFn: async () => {
      return fetchJson("/api/backend/admin/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: "free",
          base_url: freeBaseUrl,
          model: freeModel,
          temperature: freeTemp,
          fallback_provider: freeFallbackProvider,
          fallback_model: freeFallbackModel,
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-model-settings"] })
      queryClient.invalidateQueries({ queryKey: ["admin-analytics"] })
      alert("Free tier configuration updated successfully!")
    },
    onError: (err: Error) => {
      alert(`Save failed: ${err.message}`)
    },
  })

  // Test Model Connection mutation
  const testMutation = useMutation({
    mutationFn: async (tier: "pro" | "free") => {
      setTestResult(null)
      const res = await fetch("/api/backend/admin/model-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          base_url: tier === "pro" ? proBaseUrl : freeBaseUrl,
          model: tier === "pro" ? proModel : freeModel,
          prompt: "Echo test: return the exact word RESUMER_OK.",
        }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText)
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }

      const data = await res.json()
      return { tier, ...data }
    },
    onSuccess: (data) => {
      setTestResult({
        tier: data.tier,
        success: data.success ?? true,
        output: data.output,
        latency_ms: data.latency_ms,
        error: data.error,
      })
    },
    onError: (err: Error, tier) => {
      setTestResult({
        tier,
        success: false,
        error: err.message,
      })
    },
  })

  // Safe temperature parser (supports 0.0)
  const handleTempChange = (valStr: string, setter: (n: number) => void) => {
    const parsed = parseFloat(valStr)
    setter(isNaN(parsed) ? 0.2 : parsed)
  }

  return (
    <div className="space-y-6">
      {/* Overview Info Header */}
      <div className="flex items-center justify-between border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-[2px_2px_0px_#000000]">
        <div>
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#ff4e26]">
            LLM Runtime Model &amp; Routing Engine
          </h2>
          <p className="text-xs text-zinc-500">
            Configure dynamic model endpoints, base URLs, deterministic temperatures, and automatic fallback chains with zero downtime.
          </p>
        </div>
      </div>

      {/* Test Result Banner */}
      {testResult && (
        <div
          className={`border p-4 font-mono text-xs shadow-[2px_2px_0px_#000000] ${
            testResult.success
              ? "border-emerald-800 bg-emerald-950/60 text-emerald-300"
              : "border-red-800 bg-red-950/60 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2 font-bold uppercase">
            {testResult.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span>
              Connection Test Result ({testResult.tier.toUpperCase()} Tier):{" "}
              {testResult.success ? "SUCCESS" : "FAILED"}
            </span>
            {testResult.latency_ms != null && (
              <span className="ml-auto text-zinc-400 font-normal">
                Latency: {testResult.latency_ms}ms
              </span>
            )}
          </div>
          {testResult.output && (
            <p className="mt-2 text-zinc-200 bg-black/40 p-2 border border-zinc-700">
              Output: {testResult.output}
            </p>
          )}
          {testResult.error && (
            <p className="mt-2 text-red-200 bg-red-950 p-2 border border-red-800">
              Error Details: {testResult.error}
            </p>
          )}
        </div>
      )}

      {/* DUAL CONFIGURATION GRID */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* PRO TIER PANEL */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Pro Tier Configuration
              </h3>
            </div>
            <span className="font-mono text-[10px] font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 uppercase">
              Authenticated &amp; Pro Users
            </span>
          </div>

          {/* Presets Selector */}
          <div className="font-mono text-xs">
            <label className="block text-zinc-500 uppercase font-bold mb-1">Load Preset</label>
            <select
              onChange={(e) => {
                const preset = PRO_MODEL_PRESETS.find((p) => p.name === e.target.value)
                if (preset) {
                  setProBaseUrl(preset.baseUrl)
                  setProModel(preset.model)
                  setProFallbackModel(preset.fallbackModel)
                }
              }}
              className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
            >
              <option value="">-- Choose Recommended Pro Preset --</option>
              {PRO_MODEL_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Base URL</label>
              <input
                type="text"
                value={proBaseUrl}
                onChange={(e) => setProBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Model Identifier</label>
              <input
                type="text"
                value={proModel}
                onChange={(e) => setProModel(e.target.value)}
                placeholder="antigravity/gemini-3.7-flash-tiered"
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-500 uppercase font-bold mb-1">Temperature</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.0"
                  max="1.5"
                  value={proTemp}
                  onChange={(e) => handleTempChange(e.target.value, setProTemp)}
                  className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-500 uppercase font-bold mb-1">Fallback Provider</label>
                <input
                  type="text"
                  value={proFallbackProvider}
                  onChange={(e) => setProFallbackProvider(e.target.value)}
                  className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Fallback Model</label>
              <input
                type="text"
                value={proFallbackModel}
                onChange={(e) => setProFallbackModel(e.target.value)}
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => testMutation.mutate("pro")}
              disabled={testMutation.isPending}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-900 dark:text-white hover:border-[#ff4e26] transition-colors disabled:opacity-50"
            >
              <Zap size={13} />
              <span>Test Connection</span>
            </button>

            <button
              type="button"
              onClick={() => saveProMutation.mutate()}
              disabled={saveProMutation.isPending}
              className="flex items-center gap-1.5 border border-black dark:border-white bg-[#ff4e26] px-4 py-2 font-mono text-xs font-bold uppercase text-white shadow-[2px_2px_0px_#000000] hover:bg-[#e03d16] disabled:opacity-50 transition-all"
            >
              <Save size={13} />
              <span>{saveProMutation.isPending ? "Saving..." : "Save Pro Settings"}</span>
            </button>
          </div>
        </div>

        {/* FREE TIER PANEL */}
        <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-[2px_2px_0px_#000000] space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                Free Tier Configuration
              </h3>
            </div>
            <span className="font-mono text-[10px] font-bold text-blue-400 bg-blue-950 border border-blue-800 px-2 py-0.5 uppercase">
              Guest &amp; Free Plan
            </span>
          </div>

          {/* Presets Selector */}
          <div className="font-mono text-xs">
            <label className="block text-zinc-500 uppercase font-bold mb-1">Load Preset</label>
            <select
              onChange={(e) => {
                const preset = FREE_MODEL_PRESETS.find((p) => p.name === e.target.value)
                if (preset) {
                  setFreeBaseUrl(preset.baseUrl)
                  setFreeModel(preset.model)
                  setFreeFallbackModel(preset.fallbackModel)
                }
              }}
              className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-2 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
            >
              <option value="">-- Choose Recommended Free Preset --</option>
              {FREE_MODEL_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Base URL</label>
              <input
                type="text"
                value={freeBaseUrl}
                onChange={(e) => setFreeBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Model Identifier</label>
              <input
                type="text"
                value={freeModel}
                onChange={(e) => setFreeModel(e.target.value)}
                placeholder="poolside/laguna-xs-2.1:free"
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-zinc-500 uppercase font-bold mb-1">Temperature</label>
                <input
                  type="number"
                  step="0.05"
                  min="0.0"
                  max="1.5"
                  value={freeTemp}
                  onChange={(e) => handleTempChange(e.target.value, setFreeTemp)}
                  className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-500 uppercase font-bold mb-1">Fallback Provider</label>
                <input
                  type="text"
                  value={freeFallbackProvider}
                  onChange={(e) => setFreeFallbackProvider(e.target.value)}
                  className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-500 uppercase font-bold mb-1">Fallback Model</label>
              <input
                type="text"
                value={freeFallbackModel}
                onChange={(e) => setFreeFallbackModel(e.target.value)}
                className="h-9 w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 px-3 text-xs font-mono text-zinc-900 dark:text-white focus:border-[#ff4e26] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <button
              type="button"
              onClick={() => testMutation.mutate("free")}
              disabled={testMutation.isPending}
              className="flex items-center gap-1.5 border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 font-mono text-xs font-bold uppercase text-zinc-900 dark:text-white hover:border-[#ff4e26] transition-colors disabled:opacity-50"
            >
              <Zap size={13} />
              <span>Test Connection</span>
            </button>

            <button
              type="button"
              onClick={() => saveFreeMutation.mutate()}
              disabled={saveFreeMutation.isPending}
              className="flex items-center gap-1.5 border border-black dark:border-white bg-[#ff4e26] px-4 py-2 font-mono text-xs font-bold uppercase text-white shadow-[2px_2px_0px_#000000] hover:bg-[#e03d16] disabled:opacity-50 transition-all"
            >
              <Save size={13} />
              <span>{saveFreeMutation.isPending ? "Saving..." : "Save Free Settings"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
