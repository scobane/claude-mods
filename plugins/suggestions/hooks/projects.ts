// Projects and their suggestions: plain data helpers, no engine calls.
import type { Effort, Project, Suggestion, SuggestionKind } from '../types'

// ---------- plain helpers (no $) ----------

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'project'
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((one): one is string => typeof one === 'string')
}

export function same(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

export const KINDS: readonly SuggestionKind[] = ['gap', 'fix', 'quick', 'idea']
export const EFFORTS: readonly Effort[] = ['quick', 'medium', 'bigger']
export const KIND_LABEL: Record<SuggestionKind, string> = {
  gap: 'Missing',
  fix: 'Fix',
  quick: 'Quick win',
  idea: 'Creative idea',
}

export function isSuggestion(one: unknown): one is Suggestion {
  if (typeof one !== 'object' || one === null) return false
  const o = one as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.why === 'string' &&
    typeof o.source === 'string' &&
    KINDS.includes(o.kind as SuggestionKind) &&
    EFFORTS.includes(o.effort as Effort) &&
    (o.status === 'open' || o.status === 'done' || o.status === 'dismissed')
  )
}

// Keep only well-formed projects from what an earlier session saved.
export function fromStore(value: unknown): Project[] {
  if (!Array.isArray(value)) return []
  const out: Project[] = []
  for (const one of value) {
    if (typeof one !== 'object' || one === null) continue
    const o = one as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    out.push({
      id: o.id,
      name: o.name,
      goal: typeof o.goal === 'string' ? o.goal : '',
      suggestions: Array.isArray(o.suggestions) ? o.suggestions.filter(isSuggestion) : [],
    })
  }
  return out
}

// The next-steps version kept projects with goals: keep the projects and
// goals, drop the steps.
export function fromNextSteps(value: unknown): Project[] {
  if (!Array.isArray(value)) return []
  const out: Project[] = []
  for (const one of value) {
    if (typeof one !== 'object' || one === null) continue
    const o = one as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    out.push({ id: o.id, name: o.name, goal: typeof o.goal === 'string' ? o.goal : '', suggestions: [] })
  }
  return out
}

export function findProject(list: Project[], nameOrId: string): Project | undefined {
  const key = slug(nameOrId)
  return list.find(p => p.id === key || slug(p.name) === key)
}

export function ensureProject(list: Project[], name: string): [Project[], string] {
  const found = findProject(list, name)
  if (found) return [list, found.id]
  const fresh: Project = { id: slug(name), name: name.trim(), goal: '', suggestions: [] }
  return [[...list, fresh], fresh.id]
}

export function mapProject(list: Project[], id: string, fn: (p: Project) => Project): Project[] {
  return list.map(p => (p.id === id ? fn(p) : p))
}

export function openOf(p: Project | undefined): Suggestion[] {
  return p ? p.suggestions.filter(s => s.status === 'open') : []
}

export function handledOf(p: Project | undefined): Suggestion[] {
  return p ? p.suggestions.filter(s => s.status !== 'open') : []
}

export function nextId(list: Project[]): string {
  let top = 0
  for (const p of list) for (const s of p.suggestions) top = Math.max(top, Number(s.id) || 0)
  return String(top + 1)
}

export function setStatus(list: Project[], id: string, status: Suggestion['status']): Project[] {
  return list.map(p => ({
    ...p,
    suggestions: p.suggestions.map(s => (s.id === id ? { ...s, status } : s)),
  }))
}

export function folderName(cwd: string): string | null {
  // A chat with no project folder runs in a scratch workspace the app made.
  if (/scratch-workspaces/i.test(cwd)) return null
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last || /^[a-z]:$/i.test(last)) return null
  // A home folder is not a project.
  if (parts.length <= 3 && /^(users|home)$/i.test(parts[parts.length - 2] ?? '')) return null
  return last
}
