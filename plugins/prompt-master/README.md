# Prompt Master

A Claude Code mod that turns a rough prompt into a clearer, sharper one before you send it.

## Use it

- Type a rough prompt in the prompt box, then press the **✨ Prompt Master** button above the prompt (or `p` while the band has focus). The rewrite replaces your draft in the box; review or edit it, then press Enter to send.
- Changed your mind? Press **Undo** (`u`) to get your original draft back.
- Or run `/prompt-master <rough prompt>` and the rewrite lands in the prompt box.

## How it rewrites

When the session already has a conversation, the rewrite runs as a fork of it, so "fix that bug" becomes a prompt that names the actual bug and file. In a fresh session it uses a plain Sonnet completion. It keeps your intent, adds the context, constraints and "done when" your draft implies, and never invents requirements or answers the prompt itself. Each rewrite is one model call that counts toward the session's cost.
