import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Focus, Project, Suggestion } from '../types'
import { slug, text, KIND_LABEL, fromStore, fromNextSteps, findProject, openOf, setStatus, folderName } from './projects'
import { parseAnswer, applyRefresh, applyLive, briefing, refreshPrompt, reviewPrompt, GUIDANCE } from './model'

const PANE = 'suggestions'
const TITLE = 'Suggestions'
const STORE_KEY = 'suggestions'
const OLD_STORE_KEY = 'projects'
const AUTO_KEY = 'auto'
const GENERAL = 'General'

// Every project and its suggestions. Change the shape tag if the types change.
const projects = atom({ plugin: 'suggestions', key: 'projects' } as const, [] as Project[], {
  shape: 'suggestions-1',
})
// The project this session works on, if any.
const focus = atom({ plugin: 'suggestions', key: 'focus' } as const, null as Focus | null, {
  shape: 'focus-1',
})
// What the pane is doing in the background ("Looking at recipe-site…").
const busy = atom({ plugin: 'suggestions', key: 'busy' } as const, null as string | null, {
  shape: 'busy-1',
})
// Whether suggestions update themselves after Claude's replies.
const auto = atom({ plugin: 'suggestions', key: 'auto' } as const, true as boolean, {
  shape: 'auto-1',
})

// ---------- the project folder ----------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', '.venv', 'venv',
  'env', '__pycache__', '.next', '.nuxt', '.cache', '.claude', '.idea', '.vscode',
])
const KEY_FILE =
  /^(readme|claude|agents|todo|notes?|plan|planning|roadmap|tasks?|status|changelog|brief|spec|ideas?)\b[^\\/]*\.(md|markdown|txt)$/i
const MANIFEST = /^(package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod)$/i
const TEXT_FILE =
  /\.(md|markdown|txt|py|ps1|bat|cmd|sh|js|mjs|cjs|ts|tsx|jsx|html|css|json|csv|toml|ya?ml|ini|sql|go|rs|java|cs|rb|php)$/i
const NOT_WORTH_READING = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.min\.[a-z]+)$/i

type FileRow = { path: string; full: string; size: number; mtime: number }

function readable(f: FileRow): boolean {
  return f.full !== '' && TEXT_FILE.test(f.path) && !NOT_WORTH_READING.test(f.path) && f.size < 1_000_000
}

// Which files to open: notes and plans first, then what changed last.
function pickFiles(files: FileRow[]): FileRow[] {
  const byRecent = files.filter(f => f.full).sort((a, b) => b.mtime - a.mtime)
  const keys = byRecent
    .filter(f => {
      const name = f.path.split('/').pop() ?? ''
      return KEY_FILE.test(name) || (!f.path.includes('/') && MANIFEST.test(name))
    })
    // Top-level notes before ones tucked in subfolders.
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
    .slice(0, 3)
  const recent = byRecent.filter(f => readable(f) && !keys.includes(f)).slice(0, 5)
  return [...keys, ...recent]
}

// ---------- $ helpers (top-level, as the engine requires) ----------

async function save($: Pick<CoreEngineInterface, 'state' | 'store'>, fn: (list: Project[]) => Project[]) {
  const list = await update($, projects, fn)
  await $.store.set(STORE_KEY, list)
  return list
}

async function setFocus($: Pick<CoreEngineInterface, 'state'>, f: Focus | null) {
  await update($, focus, () => f)
}

// The folder the session was opened in. The working directory can move
// into a subfolder mid-session (a command that changes directory), and a
// reload then starts again from there; CLAUDE_PROJECT_DIR stays put.
async function projectFolder($: Pick<CoreEngineInterface, 'process'>, cwd: string): Promise<string> {
  try {
    const env = await $.process.hookEnv()
    const dir = env.CLAUDE_PROJECT_DIR?.trim()
    if (dir) return dir
  } catch {
    // Fall back to the working directory.
  }
  return cwd
}

// A listing of the folder and the text of the files worth reading.
async function gatherFolder($: Pick<CoreEngineInterface, 'fs'>, folder: string): Promise<string> {
  const sep = folder.includes('\\') ? '\\' : '/'
  const join = (a: string, b: string) => a.replace(/[\\/]+$/, '') + sep + b
  const files: FileRow[] = []
  const dirs: string[] = []
  // Walk the folder breadth-first, up to 5 levels and 60 folders deep, so
  // code kept in subfolders (src/app/..., plugins/x/hooks/...) is found.
  const queue: { rel: string; full: string; depth: number }[] = [{ rel: '', full: folder, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 60 && files.length < 400) {
    const dir = queue.shift()
    if (!dir) break
    visited += 1
    let entries: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      entries = await $.fs.list(dir.full)
    } catch {
      if (dir.depth === 0) throw new Error('folder not readable')
      continue
    }
    for (const one of entries.slice(0, 80)) {
      const rel = dir.rel ? `${dir.rel}/${one.name}` : one.name
      if (one.kind === 'file') {
        files.push({ path: rel, full: join(dir.full, one.name), size: one.size, mtime: one.mtimeMs })
      } else if (one.kind === 'dir' && !SKIP_DIRS.has(one.name) && !one.name.startsWith('.')) {
        dirs.push(`${rel}/`)
        if (dir.depth < 4) queue.push({ rel, full: join(dir.full, one.name), depth: dir.depth + 1 })
      }
    }
  }

  const listing = [...files]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 120)
    .map(f => `${f.path}  (${Math.max(1, Math.round(f.size / 1024))} KB)`)
    .concat(dirs.slice(0, 60))

  const texts: string[] = []
  for (const f of pickFiles(files)) {
    try {
      const body = await $.fs.read(f.full)
      const cap = /\.csv$/i.test(f.path) ? 1000 : 3500
      texts.push(`--- ${f.path} ---\n${body.slice(0, cap)}${body.length > cap ? '\n[...cut]' : ''}`)
    } catch {
      // A file that can't be read is left out.
    }
  }
  return `Files:\n${listing.join('\n') || '(empty)'}\n\n${texts.join('\n\n') || '(no readable text files)'}`
}

// Looks at the project (and the chat, when there is one) and replaces the
// open suggestions with a fresh set.
async function refresh(
  $: Pick<CoreEngineInterface, 'fs' | 'model' | 'state' | 'store' | 'ui'>,
  f: Focus,
  useChat: boolean,
): Promise<string> {
  await update($, busy, () => `Looking at ${f.name}…`)
  try {
    const folderText = f.folder ? await gatherFolder($, f.folder) : null
    const before = findProject(await read($, projects), f.id)
    let answer = useChat
      ? await $.model.fork({ prompt: refreshPrompt(f.name, before, folderText, true), effort: 'low' })
      : null
    if (!answer || (!answer.isAnswered && answer.reason === 'nothing-to-fork')) {
      if (!folderText) return 'Nothing to look at yet: chat about the project first.'
      answer = await $.model.complete({
        model: 'sonnet',
        prompt: refreshPrompt(f.name, before, folderText, false),
        maxTokens: 2000,
        timeoutMs: 120_000,
      })
    }
    if (!answer.isAnswered) return `Couldn't get suggestions (${answer.reason}).`
    const parsed = parseAnswer(answer.text)
    if (!parsed || parsed.order.length === 0) return "Couldn't read the suggestions."
    let counts = { added: 0, kept: 0 }
    await save($, all => {
      const r = applyRefresh(all, f.name, parsed)
      counts = r
      return r.list
    })
    const said = `${counts.added} new suggestion${counts.added === 1 ? '' : 's'}${
      counts.kept ? `, ${counts.kept} kept` : ''
    } for ${f.name}`
    $.ui.toast(said)
    return `${said}.`
  } catch {
    return `Couldn't look at ${f.name}.`
  } finally {
    await update($, busy, () => null)
  }
}

// After a reply: re-rank the suggestions around the work in progress.
async function review(
  $: Pick<CoreEngineInterface, 'model' | 'state' | 'store' | 'ui'>,
  lastReply: string,
) {
  const f = await read($, focus)
  const p = f ? findProject(await read($, projects), f.id) : undefined
  const answer = await $.model.fork({ prompt: reviewPrompt(f?.name ?? null, p, lastReply), effort: 'low' })
  if (!answer.isAnswered) return
  const parsed = parseAnswer(answer.text)
  if (!parsed || parsed.unchanged) return
  if (parsed.order.length === 0 && parsed.done.length === 0 && !parsed.goal) return
  if (!f && !parsed.project && parsed.order.length === 0) return
  const name = f?.name ?? parsed.project ?? GENERAL
  let r = { added: 0, finished: 0, id: '' }
  const after = await save($, all => {
    const out = applyLive(all, name, parsed)
    r = out
    return out.list
  })
  if (!f) {
    const fresh = after.find(one => one.id === r.id)
    if (fresh) await setFocus($, { id: fresh.id, name: fresh.name })
  }
  const parts: string[] = []
  if (r.added) parts.push(`${r.added} new for what you're working on`)
  if (r.finished) parts.push(`${r.finished} done`)
  if (parts.length > 0) $.ui.toast(`Suggestions: ${parts.join(', ')}`)
}

// What /prompt-master answered, when it is the rewritten prompt itself: not
// its "it's in the box" line, its usage line or one of its errors.
function sharpenedFrom(answer: string | undefined): string | null {
  const t = answer?.trim() ?? ''
  if (!t) return null
  if (/^(Rewritten prompt is in the box|Usage:|Prompt Master (failed|got an empty reply))/.test(t)) return null
  return t
}

// "Do it with Claude". Where the Prompt Master mod is installed, the draft
// goes through its rewrite and lands sharpened in the prompt box to review
// and send; where the box can't be filled, the sharpened version is sent.
// Where it isn't installed, or the person has their own draft in the box
// (the rewrite would replace it), or the rewrite fails, the draft is sent
// as it is.
async function startSuggestion(
  $: Pick<CoreEngineInterface, 'command' | 'prompt' | 'ui'>,
  projectName: string | null,
  s: Suggestion,
) {
  const draft = `Let's work on this suggestion for my project${
    projectName ? ` "${projectName}"` : ''
  }: ${s.title}. (${s.why}) Start with the most useful first step.`
  try {
    const commands = await $.command.list()
    const box = await $.prompt.read()
    if (commands.some(c => c.name === 'prompt-master') && box.text.trim() === '') {
      const ran = await $.command.run({ command: 'prompt-master', args: draft } as Parameters<typeof $.command.run>[0])
      // Prompt Master says when its rewrite is in the box; reading the box
      // back can miss it (the fill reaches the surface after the read).
      const isInBox = /^Rewritten prompt is in the box/.test(ran.text?.trim() ?? '')
      const after = await $.prompt.read()
      if (isInBox || after.text.trim() !== '') {
        $.ui.toast('Prompt Master sharpened it: review it in the prompt box, then press Enter')
        return
      }
      // Where the prompt box can't be filled, Prompt Master answers with the
      // rewritten prompt itself: send that rather than the plain draft.
      const rewritten = sharpenedFrom(ran.text)
      if (rewritten) {
        await $.prompt.submit({ text: rewritten })
        $.ui.toast('Prompt Master sharpened it and sent it')
        return
      }
    }
  } catch {
    // Fall through and send the draft as it is.
  }
  await $.prompt.submit({ text: draft })
}

// What /next, /todo and /suggest do with what follows the command.
async function runCommand(
  $: Pick<CoreEngineInterface, 'fs' | 'model' | 'state' | 'store' | 'ui'>,
  args: string,
): Promise<string> {
  const arg = args.trim()
  await $.ui.open({ id: PANE, title: TITLE })
  if (!arg) return 'Suggestions pane opened.'
  if (/^(suggest|refresh|scan)$/i.test(arg)) {
    const f = await read($, focus)
    return f ? refresh($, f, true) : 'This chat has no project yet: chat about one first.'
  }
  const toggle = /^auto\s+(on|off)$/i.exec(arg)
  if (toggle) {
    const isOn = toggle[1]?.toLowerCase() === 'on'
    await update($, auto, () => isOn)
    await $.store.set(AUTO_KEY, isOn)
    return isOn
      ? 'Suggestions will update after replies.'
      : 'Suggestions will only change when you refresh them.'
  }
  return 'Try /suggest (open the pane), /suggest refresh, or /suggest auto on|off.'
}

// ---------- hooks ----------

export const register: Register = on => {
  let lastBriefing = ''
  let isReviewing = false
  let queued: string | null = null

  on('session.start', async ($, e, next) => {
    // Load saved suggestions; the next-steps version's projects keep their goals.
    const stored = await $.store.get(STORE_KEY)
    const saved = stored === undefined ? fromNextSteps(await $.store.get(OLD_STORE_KEY)) : fromStore(stored)
    await update($, projects, list => (list.length > 0 ? list : saved))
    if (stored === undefined && saved.length > 0) await $.store.set(STORE_KEY, saved)

    const savedAuto = await $.store.get(AUTO_KEY)
    if (typeof savedAuto === 'boolean') await update($, auto, () => savedAuto)

    // A session in a project folder works on that folder's project; one with
    // no open suggestions gets a fresh set from its folder.
    const root = await projectFolder($, e.cwd)
    const folder = folderName(root)
    if (folder) {
      const existing = findProject(await read($, projects), folder)
      const f: Focus = existing
        ? { id: existing.id, name: existing.name, folder: root }
        : { id: slug(folder), name: folder, folder: root }
      await setFocus($, f)
      if (openOf(existing).length === 0) {
        $.clock.after(1500, () => void refresh($, f, false))
      }
    }

    for (const name of ['suggest', 'next', 'todo']) {
      await $.command.register({
        name,
        description: 'Open the Suggestions pane; /suggest refresh for a fresh set',
      })
    }

    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'suggestions:guidance', text: GUIDANCE, scope: 'session' }],
    }
  })

  // The open suggestions ride with the person's message when they change.
  on('prompt.submit', async ($, e, next) => {
    if (e.command) return next(e)
    const note = briefing(await read($, projects), await read($, focus))
    if (!note || note === lastBriefing) return next(e)
    lastBriefing = note
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'suggest' }, async ($, e) => ({ text: await runCommand($, e.args) }))
  on('command.run', { command: 'next' }, async ($, e) => ({ text: await runCommand($, e.args) }))
  on('command.run', { command: 'todo' }, async ($, e) => ({ text: await runCommand($, e.args) }))

  // After each reply, see whether the chat changed what's worth suggesting.
  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId || e.reason !== 'answer') return ended
    if (!(await read($, auto))) return ended

    const reply = e.answer.slice(-4000)
    if (isReviewing) {
      queued = reply
      return ended
    }
    const run = async (lastReply: string): Promise<void> => {
      isReviewing = true
      try {
        await review($, lastReply)
      } catch {
        // A failed review changes nothing.
      } finally {
        isReviewing = false
      }
      const waiting = queued
      queued = null
      if (waiting !== null) await run(waiting)
    }
    $.clock.after(0, () => void run(reply))
    return ended
  })

  // ---- The pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, projects)
    const f = await read($, focus)
    const cur = f ? findProject(list, f.id) : undefined
    const open = openOf(cur)
    const doneCount = cur ? cur.suggestions.filter(s => s.status === 'done').length : 0
    const others = list.filter(p => p.id !== f?.id && openOf(p).length > 0)
    const working = await read($, busy)
    const isAuto = await read($, auto)

    const mark = (id: string, status: Suggestion['status']) => void save($, all => setStatus(all, id, status))
    const doIt = (s: Suggestion) => void startSuggestion($, f?.name ?? null, s)
    const refreshNow = () => {
      if (f) void refresh($, f, true)
    }
    const toggleAuto = () => void update($, auto, v => !v).then(v => $.store.set(AUTO_KEY, v))

    return (
      <Box flexDirection="column" gap={1}>
        {working && (
          <Text dimColor italic>
            {working}
          </Text>
        )}

        {f ? (
          <Box flexDirection="column">
            <Text bold size="heading">
              {f.name}
            </Text>
            {cur?.goal ? (
              <Text dimColor>Goal: {cur.goal}</Text>
            ) : (
              <Text dimColor>No goal yet: refresh, or tell Claude what you're aiming for.</Text>
            )}
          </Box>
        ) : (
          <Text dimColor>
            No project for this chat yet. Talk about what you're working on and suggestions will appear.
          </Text>
        )}

        {open.map((s, i) => (
          <Box key={`card-${s.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>{s.title}</Text>
            <Text dimColor size="caption">
              #{i + 1} · {KIND_LABEL[s.kind]} · {s.effort} · from {s.source}
            </Text>
            <Text>{s.why}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key={`do-${s.id}`} label="Do it with Claude" onPress={() => doIt(s)} />
              <Button key={`done-${s.id}`} label="Done" dimColor onPress={() => mark(s.id, 'done')} />
              <Button
                key={`dismiss-${s.id}`}
                label="Not useful"
                dimColor
                onPress={() => mark(s.id, 'dismissed')}
              />
            </Box>
          </Box>
        ))}

        {f && open.length === 0 && !working && <Text>No suggestions right now.</Text>}

        {f && (
          <Box flexDirection="row" gap={2}>
            <Button key="refresh" label="Refresh suggestions" hotkey="r" onPress={refreshNow} />
            {doneCount > 0 && <Text dimColor>{doneCount} done</Text>}
          </Box>
        )}

        <Button
          key="auto"
          plain
          dimColor
          label={`Update after replies: ${isAuto ? 'on' : 'off'}`}
          onPress={toggleAuto}
        />

        {others.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor size="caption">
              OTHER PROJECTS
            </Text>
            {others.map(p => (
              <Button
                key={`focus-${p.id}`}
                plain
                dimColor
                label={`${p.name} (${openOf(p).length} suggestion${openOf(p).length === 1 ? '' : 's'})`}
                onPress={() => void setFocus($, { id: p.id, name: p.name })}
              />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
