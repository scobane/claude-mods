import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'todo',
  component: 'Pane',
  requestId: 'todo',
  props: {
    title: 'Next steps',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SCRATCH = 'C:/Users/me/AppData/Local/Claude/scratch-workspaces/abc/scratch-1'

// Stand-ins for the engine: an in-memory store and the calls the mod makes.
function engine(on: any, disk: Map<string, unknown>) {
  const clock = mock.clock(on)
  on('store.get', (_: unknown, e: { key: string }) => ({ value: disk.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    disk.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: { name: string }) => ({ value: { tool: `mcp__todo__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('ui.toast', () => ({ value: undefined }))
  return clock
}

test('a project folder session: add a step, see it as the next step, finish it', async ($, on) => {
  const disk = new Map<string, unknown>()
  engine(on, disk)
  await $.session.start({ cwd: 'C:/Users/me/recipe-site', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^recipe-site$/ }))?.text).toBe('recipe-site')
    expect((await ui.find({ type: 'Text', text: /Nothing queued/ }))?.text).toBe('Nothing queued.')

    await ui.input({ key: 'new', text: 'Export a 30-second test clip' })
    await ui.input({ key: 'new', text: 'Post it for feedback' })
    expect((await ui.find({ type: 'Text', text: /Export/ }))?.text).toBe(
      'Export a 30-second test clip',
    )
    expect((await ui.find({ type: 'Button', key: 'up-2' }))?.text).toBe('· Post it for feedback')

    await ui.press({ key: 'done' })
    expect((await ui.find({ type: 'Text', text: /^Post it/ }))?.text).toBe('Post it for feedback')
    expect((await ui.find({ type: 'Text', text: /done ·/ }))?.text).toBe('1 done · 1 to go')

    await ui.press({ key: 'done' })
    expect(await ui.find({ type: 'Button', key: 'plan' })).toBeDefined()
    await ui.unmount()

    // Start the next surface from an empty project.
    await $.tool.call({ tool: 'mcp__todo__next_steps_change', id: '1', remove: true } as never)
    await $.tool.call({ tool: 'mcp__todo__next_steps_change', id: '2', remove: true } as never)
  }
})

test("Claude's tools: goal, steps first in line, completing flags an empty queue", async ($, on) => {
  const disk = new Map<string, unknown>()
  engine(on, disk)
  await $.session.start({ cwd: SCRATCH, surface: 'desktop', isInteractive: true })

  const set = await $.tool.call({
    tool: 'mcp__todo__project_set',
    project: 'Job applications',
    goal: 'Get a summer job offer',
  } as never)
  expect(String(set.result)).toContain('Goal: Get a summer job offer')

  await $.tool.call({
    tool: 'mcp__todo__next_steps_add',
    steps: ['Update my CV'],
  } as never)
  const added = await $.tool.call({
    tool: 'mcp__todo__next_steps_add',
    steps: ['Pick 5 companies to apply to'],
    position: 'next',
  } as never)
  expect(String(added.result)).toContain('NEXT (id 2) Pick 5 companies to apply to')

  const done = await $.tool.call({ tool: 'mcp__todo__next_steps_complete', ids: ['2', '1'] } as never)
  expect(String(done.result)).toContain('No next step left')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Job/ }))?.text).toBe('Job applications')
  expect((await ui.find({ type: 'Text', text: /Goal:/ }))?.text).toBe(
    'Goal: Get a summer job offer',
  )
  await ui.unmount()
})

test("the first version's to-do items come back as an Inbox project", async ($, on) => {
  const disk = new Map<string, unknown>([
    ['items', [{ id: '1', text: 'Call the bank', isDone: false }, { broken: true }]],
  ])
  engine(on, disk)
  await $.session.start({ cwd: SCRATCH, surface: 'desktop', isInteractive: true })

  const listed = await $.tool.call({ tool: 'mcp__todo__next_steps_list' } as never)
  expect(String(listed.result)).toContain('## Inbox')
  expect(String(listed.result)).toContain('NEXT (id 1) Call the bank')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'focus-inbox' }))?.text).toBe('Inbox → Call the bank')
  await ui.unmount()
})

test('a short briefing rides with a message only when something changed', async ($, on) => {
  const disk = new Map<string, unknown>()
  engine(on, disk)
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text }
  })
  await $.session.start({ cwd: 'C:/Users/me/recipe-site', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: 'hi' } as never)
  await $.prompt.submit({ text: 'again' } as never)
  await $.tool.call({ tool: 'mcp__todo__next_steps_add', steps: ['Trim intro'] } as never)
  await $.prompt.submit({ text: 'third' } as never)

  expect(seen[0]?.[0]).toContain('Project: recipe-site')
  expect(seen[1]).toBeUndefined()
  expect(seen[2]?.[0]).toContain('Next step: (id 1) Trim intro')
})

test('the system prompt carries the assistant guidance', async ($, on) => {
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
  expect(composed.sections.map(one => one.id)).toEqual(['intro', 'todo:guidance'])
})

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

test('a new project folder gets a goal and first steps drafted from its files', async ($, on) => {
  const disk = new Map<string, unknown>()
  const clock = engine(on, disk)
  const listed: string[] = []
  on('fs.list', (_, e) => {
    listed.push(e.path)
    if (/recipe-site$/.test(e.path)) {
      return {
        value: [
          { name: 'README.md', kind: 'file', size: 900, mtimeMs: 2, isLink: false },
          { name: 'src', kind: 'dir', size: 0, mtimeMs: 3, isLink: false },
          { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 1, isLink: false },
        ],
      }
    }
    return { value: [{ name: 'recipe.html', kind: 'file', size: 4000, mtimeMs: 9, isLink: false }] }
  })
  on('fs.read', () => ({ value: '# Recipe site\nShares family recipes online.' }))
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: `Here you go:
{"goals":[{"project":"recipe-site","goal":"Share family recipes online"}],
 "add":[{"project":"recipe-site","step":"Write the recipe page template in src/recipe.html"},
        {"project":"recipe-site","step":"Add a search box"}],"complete":[]}`,
      },
    }
  })

  await $.session.start({ cwd: 'C:/Users/me/recipe-site', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()

  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Shares family recipes online.')
  expect(prompts[0]).toContain('src/recipe.html')
  expect(listed.some(path => path.includes('node_modules'))).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Goal:/ }))?.text).toBe(
    'Goal: Share family recipes online',
  )
  expect((await ui.find({ type: 'Text', text: /recipe page template/ }))?.text).toBe(
    'Write the recipe page template in src/recipe.html',
  )
  await ui.unmount()

  // The next session in that folder does not read it again by itself.
  await $.session.start({ cwd: 'C:/Users/me/recipe-site', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)
  await clock.settle()
  expect(prompts.length).toBe(1)
})

test('after a reply, the chat review ticks off and adds steps; it can be turned off', async ($, on) => {
  const disk = new Map<string, unknown>()
  const clock = engine(on, disk)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const forks: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        usage: USAGE,
        text: '{"goals":[],"add":[{"project":"Health","step":"Buy floss"},{"project":"Health","step":"Book dentist"}],"complete":["1"]}',
      },
    }
  })

  await $.session.start({ cwd: SCRATCH, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__todo__next_steps_add', project: 'Health', steps: ['Book dentist'] } as never)

  const turn = { turnId: 't1', reason: 'answer', answer: 'Glad the dentist is booked.', durationMs: 1, isAborted: false }
  await $.turn.complete(turn as never)
  await clock.advance(0)
  await clock.settle()

  expect(forks.length).toBe(1)
  expect(forks[0]).toContain('Glad the dentist is booked.')
  const listed = String((await $.tool.call({ tool: 'mcp__todo__next_steps_list' } as never)).result)
  expect(listed).toContain('NEXT (id 2) Buy floss')
  expect(listed).toContain('1 step done')
  // "Book dentist" already existed, so it was not added again.
  expect(listed.match(/Book dentist/g)?.length ?? 0).toBe(0)

  // A subagent's turn is not reviewed.
  await $.turn.complete({ ...turn, agentId: 'a1' } as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(1)

  // Turned off, nothing is reviewed.
  const off = await $.command.run({ command: 'next', args: 'auto off' } as never)
  expect(off.text).toContain('only change when')
  expect(disk.get('auto')).toBe(false)
  await $.turn.complete(turn as never)
  await clock.advance(0)
  await clock.settle()
  expect(forks.length).toBe(1)
})
