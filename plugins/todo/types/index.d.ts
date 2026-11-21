export type SuggestionKind = 'gap' | 'fix' | 'quick' | 'idea'
export type Effort = 'quick' | 'medium' | 'bigger'

export type Suggestion = {
  id: string
  kind: SuggestionKind
  title: string
  why: string
  // Where it came from: a file in the project, or "chat".
  source: string
  effort: Effort
  status: 'open' | 'done' | 'dismissed'
}

export type Project = { id: string; name: string; goal: string; suggestions: Suggestion[] }

// The project this session works on: its id, display name and, for a
// project folder, the folder's path.
export type Focus = { id: string; name: string; folder?: string }

declare module 'claude-code' {
  interface PluginState {
    todo: {
      projects: Shaped<Project[]>
      focus: Shaped<Focus | null>
      // What the pane is doing in the background, shown at its top.
      busy: Shaped<string | null>
      // Whether suggestions update themselves after Claude's replies.
      auto: Shaped<boolean>
    }
  }
}
