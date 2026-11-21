import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'suggestions',
  component: 'Pane',
  requestId: 'suggestions',
  props: {
    title: 'Suggestions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const FOLDER = 'C:/Users/me/recipe-site'
const SCRATCH = 'C:/Users/me/AppData/Local/Claude/scratch-workspaces/abc/scratch-1'
const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const FIRST_SET = JSON.stringify({
  goal: 'Share family recipes online',
  suggestions: [
    {
      kind: 'fix',
      title: 'Escape recipe text before inserting it into the page',
      why: 'src/app.js puts recipe text into innerHTML, so a stray < breaks the page.',
      source: 'src/app.js',
      effort: 'quick',
    },
    {
      kind: 'gap',
      title: 'Add the search box the README promises',
      why: 'The README plans a search box but nothing in src/ handles it.',
      source: 'README.md',
      effort: 'medium',
    },
  ],
})

// Stand-ins for the engine: an in-memory store, a clock, a small folder.
function engine(on: any, disk: Map<string, unknown>, projectDir?: string) {
  const clock = mock.clock(on)
  on('process.hookEnv', () => ({ value: projectDir ? { CLAUDE_PROJECT_DIR: projectDir } : {} }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: disk.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    disk.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.push(e.context)
    return { text: e.text }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  const listed: string[] = []
  on('fs.list', (_: unknown, e: { path: string }) => {
    listed.push(e.path)
    if (/recipe-site$/.test(e.path)) {
      return {
        value: [
          { name: 'README.md', kind: 'file', size: 900, mtimeMs: 2, isLink: false },
          { name: 'photo.jpg', kind: 'file', size: 90000, mtimeMs: 8, isLink: false },
          { name: 'src', kind: 'dir', size: 0, mtimeMs: 3, isLink: false },
          { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 1, isLink: false },
        ],
      }
    }
    if (/src$/.test(e.path)) {
      return {
        value: [
          { name: 'app.js', kind: 'file', size: 4000, mtimeMs: 9, isLink: false },
          { name: 'lib', kind: 'dir', size: 0, mtimeMs: 9, isLink: false },
        ],
      }
    }
    if (/lib$/.test(e.path)) {
      return { value: [{ name: 'search.js', kind: 'file', size: 2000, mtimeMs: 10, isLink: false }] }
    }
    return { value: [] }
  })
  on('fs.read', (_: unknown, e: { path: string }) => ({
    value: /README/.test(e.path)
      ? '# Recipe site\nPlan: home page, recipe pages, a search box.'
      : /search\.js$/.test(e.path)
        ? 'export function search(q) { /* TODO */ }'
        : 'list.innerHTML = recipe.text',
  }))
  return { clock, listed, seen }
}

async function startInFolder($: any, clock: any) {
  await $.session.start({ cwd: FOLDER, surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()
}

test('a project folder gets grounded suggestions from its files', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock, listed } = engine(on, disk)
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }
  })
  await startInFolder($, clock)

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('list.innerHTML = recipe.text')
  expect(prompts[0]).toContain('a search box')
  expect(prompts[0]).toContain('photo.jpg')
  // Code two folders down is found and read too.
  expect(prompts[0]).toContain('src/lib/search.js')
  expect(prompts[0]).toContain('export function search(q)')
  // The prompt ties every suggestion to the goal, ranks by impact and asks
  // for a creative idea.
  expect(prompts[0]).toContain('Goal: not set yet.')
  expect(prompts[0]).toContain("Leave out improvements that don't connect to the goal")
  expect(prompts[0]).toContain('how doing it advances the goal')
  expect(prompts[0]).toContain("How easy something is doesn't decide its place")
  expect(prompts[0]).toContain('At least one must be kind "idea"')
  expect(listed.some(path => path.includes('node_modules'))).toBe(false)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Goal:/ }))?.text).toBe('Goal: Share family recipes online')
    expect((await ui.find({ type: 'Text', text: /^Escape recipe/ }))?.text).toBe(
      'Escape recipe text before inserting it into the page',
    )
    expect((await ui.find({ type: 'Text', text: /from src/ }))?.text).toBe('Fix · quick · from src/app.js')
    expect(await ui.find({ type: 'Button', key: 'do-2' })).toBeDefined()
    await ui.unmount()
  }

  // A later session in the same folder keeps the open suggestions.
  await startInFolder($, clock)
  expect(prompts.length).toBe(1)
})

test('Done and Not useful clear a card, and a refresh never brings it back', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }
  })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage: USAGE } }))
  await startInFolder($, clock)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'done-1' })
  await ui.press({ key: 'dismiss-2' })
  expect(await ui.find({ type: 'Text', text: /^Escape recipe/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /No suggestions/ }))?.text).toBe('No suggestions right now.')
  expect((await ui.find({ type: 'Text', text: /done$/ }))?.text).toBe('1 done')

  // Refresh: no chat yet, so it falls back to reading the folder alone.
  await ui.press({ key: 'refresh' })
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('Escape recipe text before inserting it into the page (done)')
  expect(prompts[1]).toContain('Add the search box the README promises (marked not useful)')
  expect(await ui.find({ type: 'Text', text: /^Escape recipe/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /No suggestions/ }))?.text).toBe('No suggestions right now.')
  await ui.unmount()
})

test('/suggest refresh uses the conversation when there is one', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  const forks: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: JSON.stringify({
          suggestions: [
            {
              kind: 'quick',
              title: 'Add alt text to the recipe photos',
              why: 'We added photos in this chat without alt text.',
              source: 'chat',
              effort: 'quick',
            },
          ],
        }),
      },
    }
  })
  await startInFolder($, clock)

  const ran = await $.command.run({ command: 'suggest', args: 'refresh' } as never)
  expect(ran.text).toBe('1 new suggestion for recipe-site.')
  expect(forks[0]).toContain('Use the conversation above')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Add alt text/ }))?.text).toBe('Add alt text to the recipe photos')
  // The refresh replaced the earlier open suggestions.
  expect(await ui.find({ type: 'Text', text: /^Escape recipe/ })).toBeUndefined()
  await ui.unmount()
})

test('after a reply, the list re-ranks around the work just done; it can be turned off', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  const forks: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: JSON.stringify({
          done: ['1'],
          suggestions: [
            {
              kind: 'fix',
              title: 'Handle an empty recipe list on the home page',
              why: 'The escaping fix just made assumes at least one recipe; an empty home page would stop anyone sharing their first recipe.',
              source: 'chat: the escaping fix just made',
              effort: 'quick',
            },
            { keep: '2' },
            suggestion('idea', 'Preview the escaped recipe while it is typed'),
          ],
        }),
      },
    }
  })
  await startInFolder($, clock)

  const turn = { turnId: 't1', reason: 'answer', answer: 'I escaped the recipe text.', durationMs: 1, isAborted: false }
  await $.turn.complete(turn as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(1)
  expect(forks[0]).toContain('I escaped the recipe text.')
  expect(forks[0]).toContain('Goal: Share family recipes online')
  expect(forks[0]).toContain('Weigh the LATEST exchange most heavily')
  expect(forks[0]).toContain('Lead with the next useful moves for the work in progress')
  expect(forks[0]).toContain('1. (id 1) [fix] Escape recipe text')
  expect(forks[0]).toContain('{"keep":"<its id>"}')
  expect(forks[0]).toContain('("chat: <a few words>")')

  // The next move for the work just done leads; the still-useful open card is
  // kept; the finished one is ticked off; a creative idea rides along.
  expect(openTitles(disk)).toEqual([
    'Handle an empty recipe list on the home page',
    'Add the search box the README promises',
    'Preview the escaped recipe while it is typed',
  ])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Escape recipe/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Handle an empty/ }))?.text).toBe(
    'Handle an empty recipe list on the home page',
  )
  await ui.unmount()

  // A subagent's turn is not reviewed.
  await $.turn.complete({ ...turn, agentId: 'a1' } as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(1)

  // Turned off, nothing is reviewed.
  const off = await $.command.run({ command: 'suggest', args: 'auto off' } as never)
  expect(off.text).toContain('only change when you refresh')
  expect(disk.get('auto')).toBe(false)
  await $.turn.complete(turn as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(1)
})

test('the open suggestions ride with a message only when they change', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock, seen } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  await startInFolder($, clock)

  await $.prompt.submit({ text: 'hi' } as never)
  await $.prompt.submit({ text: 'again' } as never)

  expect(seen[0]?.[0]).toContain('[Suggestions pane: recipe-site - goal: Share family recipes online]')
  expect(seen[0]?.[0]).toContain('1. Escape recipe text before inserting it into the page (Fix, quick)')
  expect(seen[1]).toBeUndefined()
})

test("the next-steps version's projects keep their goals", async ($, on) => {
  const disk = new Map<string, unknown>([
    [
      'projects',
      [{ id: 'garden', name: 'garden', goal: 'Grow tomatoes', steps: [{ id: '1', text: 'Buy seeds', isDone: false }] }],
    ],
  ])
  engine(on, disk)
  await $.session.start({ cwd: SCRATCH, surface: 'desktop', isInteractive: true })

  const saved = disk.get('suggestions') as { name: string; goal: string; suggestions: unknown[] }[]
  expect(saved).toEqual([{ id: 'garden', name: 'garden', goal: 'Grow tomatoes', suggestions: [] }])
})

test('the system prompt tells Claude about the pane', async ($, on) => {
  on('prompt.compose', () => ({
    sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }],
  }))
  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['desktop'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(one => one.id)).toEqual(['intro', 'suggestions:guidance'])
})

function suggestion(kind: string, title: string, rank?: number) {
  return { kind, title, why: `Seen in src/app.js; moves the site toward sharing recipes.`, source: 'src/app.js', effort: 'medium', rank }
}

function openTitles(disk: Map<string, unknown>): string[] {
  const saved = disk.get('suggestions') as { suggestions: { title: string; status: string }[] }[]
  return (saved[0]?.suggestions ?? []).filter(s => s.status === 'open').map(s => s.title)
}

test('a set of more than five keeps its creative idea, in goal-impact order', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      usage: USAGE,
      text: JSON.stringify({
        goal: 'Share family recipes online',
        suggestions: [
          suggestion('gap', 'A'),
          suggestion('fix', 'B'),
          suggestion('gap', 'C'),
          suggestion('quick', 'D'),
          suggestion('fix', 'E'),
          suggestion('idea', 'Let relatives add recipes by email'),
        ],
      }),
    },
  }))
  await startInFolder($, clock)

  expect(openTitles(disk)).toEqual(['A', 'B', 'C', 'D', 'Let relatives add recipes by email'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Creative idea/ }))?.text).toBe(
    'Creative idea · medium · from src/app.js',
  )
  await ui.unmount()
})

test('a higher-impact addition after a reply pushes out the lowest, never the only idea', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      usage: USAGE,
      text: JSON.stringify({
        goal: 'Share family recipes online',
        suggestions: [
          suggestion('gap', 'A'),
          suggestion('fix', 'B'),
          suggestion('gap', 'C'),
          suggestion('quick', 'D'),
          suggestion('idea', 'Let relatives add recipes by email'),
        ],
      }),
    },
  }))
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      usage: USAGE,
      text: JSON.stringify({
        done: [],
        suggestions: [
          suggestion('gap', 'New most important'),
          { keep: '1' },
          { keep: '2' },
          { keep: '3' },
          { keep: '4' },
          { keep: '5' },
        ],
      }),
    },
  }))
  await startInFolder($, clock)

  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  await clock.advance(0)
  await clock.settle()

  expect(openTitles(disk)).toEqual(['New most important', 'A', 'B', 'C', 'Let relatives add recipes by email'])
})

test('a session whose working directory moved into a subfolder still names the project from its root', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock, listed } = engine(on, disk, FOLDER)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))

  await $.session.start({ cwd: `${FOLDER}/src/lib`, surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()

  expect(listed[0]?.split('\\').join('/')).toBe(FOLDER)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^recipe-site$/ }))?.text).toBe('recipe-site')
  expect(await ui.find({ type: 'Text', text: /^lib$/ })).toBeUndefined()
  await ui.unmount()
})

test('a refresh keeps open suggestions that still apply, in their new ranked place', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  const forks: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: JSON.stringify({
          suggestions: [
            { keep: '2' },
            suggestion('idea', 'Let relatives add recipes by email'),
            { keep: '99' },
            // A new card that repeats a kept one is not added twice.
            suggestion('gap', 'Add the search box the README promises'),
          ],
        }),
      },
    }
  })
  await startInFolder($, clock)

  const ran = await $.command.run({ command: 'suggest', args: 'refresh' } as never)
  expect(ran.text).toBe('1 new suggestion, 1 kept for recipe-site.')
  expect(forks[0]).toContain("Open suggestions the person hasn't acted on yet")
  expect(forks[0]).toContain('(id 1) [fix] Escape recipe text')
  expect(forks[0]).toContain('{"keep":"<its id>"}')

  const saved = disk.get('suggestions') as { suggestions: { id: string; title: string; status: string }[] }[]
  const open = (saved[0]?.suggestions ?? []).filter(s => s.status === 'open')
  // The kept card is the same card (same id), now first; the one left out is gone.
  expect(open.map(s => [s.id, s.title])).toEqual([
    ['2', 'Add the search box the README promises'],
    ['3', 'Let relatives add recipes by email'],
  ])
})

test('after small talk, or an answer that only ticks off, the list stays put', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  const answers = [JSON.stringify({ unchanged: true }), JSON.stringify({ done: ['2'] })]
  const forks: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true, usage: USAGE, text: answers[forks.length - 1] ?? '{}' } }
  })
  await startInFolder($, clock)
  const before = openTitles(disk)

  const turn = { turnId: 't1', reason: 'answer', answer: 'Happy Friday!', durationMs: 1, isAborted: false }
  await $.turn.complete(turn as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks[0]).toContain('answer {"unchanged":true}')
  expect(openTitles(disk)).toEqual(before)

  await $.turn.complete({ ...turn, turnId: 't2', answer: 'The search box is in.' } as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(2)
  expect(openTitles(disk)).toEqual(['Escape recipe text before inserting it into the page'])
})

test('cards stay short: one-sentence reasons, overlong text clipped at a word', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock } = engine(on, disk)
  const prompts: string[] = []
  const longWhy = `${'The recipe page template in src/recipe.html repeats the same markup for every section '.repeat(4)}end.`
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: JSON.stringify({
          goal: 'Share family recipes online',
          suggestions: [
            { ...suggestion('fix', 'Share one template across every recipe section of the site please'), why: longWhy },
            suggestion('idea', 'Let relatives add recipes by email'),
          ],
        }),
      },
    }
  })
  await startInFolder($, clock)

  expect(prompts[0]).toContain('"title" (an imperative, at most 8 words)')
  expect(prompts[0]).toContain('"why" is ONE short sentence of at most 25 words')

  const saved = disk.get('suggestions') as { suggestions: { title: string; why: string }[] }[]
  const card = saved[0]?.suggestions[0]
  expect((card?.why.length ?? 0) <= 220).toBe(true)
  expect(card?.why.endsWith('…')).toBe(true)
  expect(card?.why.includes('  ')).toBe(false)
  // A title within the limit is kept whole.
  expect(card?.title).toBe('Share one template across every recipe section of the site please')
})

test('Do it with Claude goes through Prompt Master when it can, and sends directly when not', async ($, on) => {
  const disk = new Map<string, unknown>()
  const { clock, seen } = engine(on, disk)
  on('model.complete', () => ({ value: { isAnswered: true, usage: USAGE, text: FIRST_SET } }))
  let hasPromptMaster = true
  let box = ''
  const rewrites: string[] = []
  on('command.list', () => ({
    value: hasPromptMaster
      ? [{ name: 'prompt-master', description: '', source: 'plugin', isFullscreen: false }]
      : [],
  }))
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('command.run', (_, e) => {
    rewrites.push(e.args)
    box = `SHARPENED: ${e.args}`
    return { text: 'Rewritten prompt is in the box: edit it or press Enter to send.' }
  })
  await startInFolder($, clock)
  const sent = () => seen.length

  // 1. Prompt Master installed, empty box: the rewrite lands in the box, nothing is sent.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const before = sent()
  await ui.press({ key: 'do-1' })
  expect(rewrites.length).toBe(1)
  expect(rewrites[0]).toContain('Escape recipe text before inserting it into the page')
  expect(box.startsWith('SHARPENED:')).toBe(true)
  expect(sent()).toBe(before)

  // 2. The person has their own draft in the box: it is left alone and the
  //    suggestion is sent as it is.
  box = 'my own half-written prompt'
  await ui.press({ key: 'do-2' })
  expect(rewrites.length).toBe(1)
  expect(box).toBe('my own half-written prompt')
  expect(sent()).toBe(before + 1)

  // 3. No Prompt Master: sent as it is.
  hasPromptMaster = false
  box = ''
  await ui.press({ key: 'do-1' })
  expect(rewrites.length).toBe(1)
  expect(sent()).toBe(before + 2)
  await ui.unmount()
})
