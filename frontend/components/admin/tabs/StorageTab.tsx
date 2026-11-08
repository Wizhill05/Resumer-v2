"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import type { StorageList } from "../api-types"
import { FIELD_CLASS, Note, Panel, RefreshButton, fetchJson, sendJson } from "../shared"

const kb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`)

export function StorageTab() {
  const queryClient = useQueryClient()
  const [prefix, setPrefix] = useState("")
  const { data, isFetching } = useQuery<StorageList>({
    queryKey: ["admin", "storage", prefix],
    queryFn: () => fetchJson<StorageList>(`/api/backend/admin/storage/objects?prefix=${encodeURIComponent(prefix)}`),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "storage"] })
  const remove = useMutation({
    mutationFn: (key: string) => sendJson("/api/backend/admin/storage/object", "DELETE", { key }, "Delete failed"),
    onSuccess: refresh,
  })
  const objects = data?.objects ?? []
  const open = (key: string) => window.open(`/api/backend/admin/storage/object?key=${encodeURIComponent(key)}`, "_blank")

  return (
    <div className="space-y-4 pixel-enter">
      <div className="flex gap-2 border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Prefix filter" aria-label="Prefix filter" className={FIELD_CLASS} />
        <RefreshButton onClick={refresh} busy={isFetching} />
      </div>
      {data?.error && <Note tone="error">{data.error}</Note>}
      {remove.isError && <Note tone="error">That object could not be deleted.</Note>}
      {objects.length === 0 && !isFetching && !data?.error && <Note>No objects under this prefix.</Note>}

      <ul className="space-y-3 md:hidden">
        {objects.map((obj) => (
          <li key={obj.key} className="panel-strong p-3">
            <p className="break-all font-mono text-xs">{obj.key}</p>
            <p className="mt-1 text-[11px] text-zinc-500">{kb(obj.size)} · {obj.last_modified ? new Date(obj.last_modified).toLocaleString() : "-"}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => open(obj.key)}>Meta</Button>
              <Button size="sm" variant="ghost" className="min-h-11 text-red-600" onClick={() => confirm("Delete object?") && remove.mutate(obj.key)}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
      {objects.length > 0 && (
        <Panel className="hidden overflow-x-auto p-0 sm:p-0 md:block">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-100 font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <tr><th className="p-3">Key</th><th className="p-3">Size</th><th className="p-3">Modified</th><th className="p-3 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {objects.map((obj) => (
                <tr key={obj.key}>
                  <td className="break-all p-3 font-mono">{obj.key}</td>
                  <td className="whitespace-nowrap p-3">{kb(obj.size)}</td>
                  <td className="p-3">{obj.last_modified ? new Date(obj.last_modified).toLocaleString() : "-"}</td>
                  <td className="space-x-1.5 whitespace-nowrap p-3 text-right">
                    <Button size="xs" variant="outline" onClick={() => open(obj.key)}>Meta</Button>
                    <Button size="xs" variant="ghost" onClick={() => confirm("Delete object?") && remove.mutate(obj.key)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  )
}
