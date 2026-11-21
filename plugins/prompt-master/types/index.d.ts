/** The rough draft before the last rewrite, for Undo; null when none. */
export type Original = string | null

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': {
      /** True while a rewrite is running. */
      isBusy: boolean
      original: Original
    }
  }
}
