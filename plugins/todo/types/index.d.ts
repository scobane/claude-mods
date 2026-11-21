export type Step = { id: string; text: string; isDone: boolean }

export type Project = { id: string; name: string; goal: string; steps: Step[] }

// The project this session works on: its id, display name and, for a
// project folder, the folder's path. It may have no steps yet.
export type Focus = { id: string; name: string; folder?: string }

declare module 'claude-code' {
  interface PluginState {
    todo: {
      projects: Shaped<Project[]>
      focus: Shaped<Focus | null>
      // What the assistant is doing in the background, shown in the pane.
      busy: Shaped<string | null>
      // Whether the assistant updates the steps from the chat by itself.
      auto: Shaped<boolean>
    }
  }
}
