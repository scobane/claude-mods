# Claude Mods

Mods for [Claude Code](https://claude.com/claude-code). This repository is a
plugin marketplace, so each mod installs with one line.

## Suggestions (`suggestions`)

A pane beside the chat with 3–5 specific suggestions for getting the project
you're working on closer to its goal: "here is what else you can do".

- **Grounded in your project.** It reads the project folder (README, notes,
  plans and the most recently changed text and code files) and the
  conversation. Each suggestion says where it came from ("from src/app.js",
  "from chat"); no generic advice.
- **Tied to your goal.** Each suggestion says how it moves the project toward
  the goal shown in the pane; improvements that don't serve the goal are left
  out. They're ranked by how much they move the goal, not by how easy they are.
- **Four kinds:** *Missing* (something the goal needs that isn't there),
  *Fix* (a weak spot that holds the goal back), *Quick win* (under ~15
  minutes) and *Creative idea* (a less obvious angle, feature or approach,
  still grounded in your files or chat). Every set has at least one creative
  idea.
- **On each card:** **Do it with Claude** starts working on it, **Done** and
  **Not useful** clear it. Cleared suggestions are never suggested again.
  With **Prompt Master** installed too, **Do it with Claude** first sharpens
  the request and puts it in the prompt box to review and send (unless you
  already have a draft there); where the box can't be filled, it sends the
  sharpened request.
- **Follows the work.** After each of Claude's replies it re-ranks the list
  around what was just done and what's in progress: it ticks off what the
  exchange finished, leads with the next useful moves for the work at hand,
  keeps open cards that still apply, and leaves the list alone after small
  talk. **Refresh suggestions** gets a fresh set from the whole project.
- A session started in a project folder opens on that folder's project; other
  projects are listed with their suggestion count.

### Commands

| Command | What it does |
| --- | --- |
| `/suggest` | Open the pane |
| `/suggest refresh` | Get a fresh set of suggestions |
| `/suggest auto on` / `/suggest auto off` | Turn the after-each-reply check on or off |

`/next` and `/todo` work the same as `/suggest`.

### Cost

A fresh set is one model call (when you refresh, or the first time a project
folder has none); the check after each reply is one quick extra call. Both
count toward your Claude usage. Turn the check off with `/suggest auto off` or
the **Update after replies** switch in the pane.

## Prompt Master (`prompt-master`)

Turns a rough prompt into a clearer, sharper one before you send it.

- Type a rough prompt, then click **✨ Prompt Master** above the prompt box.
  The rewrite replaces your draft; review or edit it, then press Enter.
  **Undo** puts your original back.
- `/prompt-master <rough prompt>` does the same from a command.
- In a session with a conversation it rewrites with that context, so "fix
  that bug" names the actual bug and file; in a fresh session it uses Sonnet.
  Each rewrite is one model call.

Install it the same way as below, with `prompt-master` in place of `suggestions`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install suggestions --marketplace scobane/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (Enter for your user
account, so it works in every project).

From a shell:

```
claude plugin install suggestions --marketplace scobane/claude-mods
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to
the prompt box, then **Plugins**, **Add marketplace** with
`scobane/claude-mods`, then **Add plugin**.

To use it in one project folder only, run this inside that folder:

```
claude plugin install suggestions@claude-mods --scope local
```

## Developing

Each mod lives in `plugins/<mod>/`. Check a change with:

```
claude plugin validate plugins/suggestions
claude plugin test plugins/suggestions
```
