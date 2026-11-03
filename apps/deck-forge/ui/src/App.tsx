import { useAppApi } from '@kirocrew/app-sdk'
import { Card, CardTitle, PageHeader, Btn, Badge } from '@kirocrew/app-sdk/ui'
import { useEffect, useRef, useState } from 'react'

type Job = {
  id: string; prompt: string; status: string; slides?: number; title?: string; error?: string
  trace_id?: string; trace_url?: string; feedback?: 'up' | 'down'
}
const BASE = '/apps/deck-forge/api'

// A per-browser session id so all decks generated from this dashboard group into one Langfuse session.
function sessionId(): string | undefined {
  try {
    const k = 'deck-forge-session'
    let v = localStorage.getItem(k)
    if (!v) { v = 'df-' + Math.random().toString(36).slice(2, 12); localStorage.setItem(k, v) }
    return v
  } catch { return undefined }
}

export default function DeckForge() {
  const api = useAppApi()
  const [prompt, setPrompt] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const timer = useRef<any>(null)

  const refresh = async () => {
    try { const j = await api.get(`${BASE}/jobs`); if (Array.isArray(j)) setJobs(j) } catch { /* backend starting */ }
  }
  useEffect(() => { refresh(); return () => clearInterval(timer.current) }, [])
  useEffect(() => {
    clearInterval(timer.current)
    if (jobs.some(j => !['done', 'error'].includes(j.status))) timer.current = setInterval(refresh, 3000)
  }, [jobs])

  const generate = async () => {
    if (!prompt.trim()) return
    setBusy(true)
    try { await api.post(`${BASE}/generate`, { prompt, sessionId: sessionId() }); await refresh() } finally { setBusy(false) }
  }

  const rate = async (j: Job, positive: boolean) => {
    try { await api.post(`${BASE}/feedback`, { id: j.id, positive }); await refresh() } catch { /* ignore */ }
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <PageHeader title="Deck Forge" subtitle="Describe a deck; get a .pptx." />
      <Card>
        <CardTitle>Prompt</CardTitle>
        <textarea data-testid="deck-forge-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
          placeholder="e.g. Quarterly business review for a SaaS startup, 6 slides"
          style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 6, background: 'transparent', color: 'inherit', border: '1px solid var(--color-border, #555)' }} />
        <div style={{ marginTop: 8 }}>
          <Btn data-testid="deck-forge-generate" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? 'Submitting…' : 'Generate'}</Btn>
        </div>
      </Card>
      <Card>
        <CardTitle>Decks</CardTitle>
        {jobs.length === 0 && <p style={{ opacity: 0.7 }}>No decks yet.</p>}
        {jobs.map(j => (
          <div key={j.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(128,128,128,.2)' }}>
            <Badge>{j.status}</Badge>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{j.title || j.prompt}</div>
              {j.error && <div style={{ color: '#e55' }}>{j.error}</div>}
              {j.slides && <div style={{ opacity: 0.7 }}>{j.slides} slides</div>}
            </div>
            {j.trace_url && <a data-testid="deck-forge-trace" href={j.trace_url} target="_blank" rel="noreferrer">View trace</a>}
            {j.trace_id && ['done', 'error'].includes(j.status) && (
              <span style={{ display: 'flex', gap: 4 }}>
                <button data-testid="deck-forge-up" title="Good deck" onClick={() => rate(j, true)}
                  style={{ opacity: j.feedback === 'down' ? 0.4 : 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>👍</button>
                <button data-testid="deck-forge-down" title="Bad deck" onClick={() => rate(j, false)}
                  style={{ opacity: j.feedback === 'up' ? 0.4 : 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>👎</button>
              </span>
            )}
            {j.status === 'done' && <a href={`${BASE}/download/${j.id}`} download>Download .pptx</a>}
          </div>
        ))}
      </Card>
    </div>
  )
}
