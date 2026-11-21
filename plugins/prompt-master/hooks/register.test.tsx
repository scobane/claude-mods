import { expect, test } from 'claude-code/testing'

import { clean } from './register'

const BAND = {
  plugin: 'prompt-master',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the button rewrites the draft in place, and Undo puts it back', async ($, on) => {
  let box = 'fix the login thing its broken'
  const asked: string[] = []
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text

    return { isFilled: true, text: box, cursor: box.length }
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return {
      value: {
        isAnswered: true,
        text: '```\nFix the broken login in auth.ts so valid users can sign in.\n```',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('ui.status', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    box = 'fix the login thing its broken'
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'prompt-master' })

    expect(box).toBe('Fix the broken login in auth.ts so valid users can sign in.')
    expect(asked.at(-1)).toContain('<rough_prompt>\nfix the login thing its broken\n</rough_prompt>')

    await ui.press({ key: 'undo' })
    expect(box).toBe('fix the login thing its broken')
    await ui.unmount()
  }
})

test('a fresh session with no conversation falls back to a plain completion', async ($, on) => {
  let box = 'make readme better'
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text

    return { isFilled: true, text: box, cursor: box.length }
  })
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
  on('model.complete', (_, e) => ({
    value: {
      isAnswered: true,
      text: `Improve README.md (${e.model}).`,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('ui.status', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'prompt-master' })

  expect(box).toBe('Improve README.md (sonnet).')
  await ui.unmount()
})

test('an empty box rewrites nothing', async ($, on) => {
  let toasts = 0
  let calls = 0
  on('prompt.read', () => ({ value: { text: '  ', cursor: 0 } }))
  on('ui.toast', () => {
    toasts += 1

    return { value: undefined }
  })
  on('model.fork', () => {
    calls += 1

    return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'prompt-master' })

  expect(calls).toBe(0)
  expect(toasts).toBe(1)
  await ui.unmount()
})

test('clean strips fences, tags and quotes', () => {
  expect(clean('```markdown\nDo X.\n```')).toBe('Do X.')
  expect(clean('<rewritten_prompt>\nDo Y.\n</rewritten_prompt>')).toBe('Do Y.')
  expect(clean('"Do Z."')).toBe('Do Z.')
})
