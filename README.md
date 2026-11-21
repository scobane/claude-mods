# Claude Mods

Mods for [Claude Code](https://claude.com/claude-code). This repository is a
plugin marketplace, so each mod installs with one line.

## Next steps (`todo`)

A project assistant in a pane beside the chat. For each of your projects it
keeps a goal, the **one next step**, and a short queue of what comes after.

- **Knows your project.** A session started in a project folder opens on that
  folder's project. The first time, it reads the folder (README, notes, plans,
  recently changed files) and drafts the goal and first steps.
- **Keeps itself current.** After each of Claude's replies it reviews the chat
  in the background: it ticks off what you finished, adds work you mention as
  small concrete steps, and records goals you state. A short pop-up says what
  changed.
- **Helps you start.** Buttons on the next step: **Done**, **Help me start**
  (Claude breaks it down with you), **Later**. When nothing is queued:
  **Draft from folder** or **Plan with Claude**.
- **Works across projects.** Other projects are listed with their own next
  step; click one to switch to it.

### Commands

| Command | What it does |
| --- | --- |
| `/next` | Open the pane |
| `/next <step>` | Add a step to this project |
| `/next scan` | Re-read the project folder and draft steps |
| `/next auto on` / `/next auto off` | Turn the after-each-reply review on or off |

`/todo` works the same as `/next`.

### Cost

Reading a folder is one model call per new project; the review after each
reply is one quick extra call. Both count toward your Claude usage. Turn the
review off with `/next auto off` or the **Update from chat** switch in the pane.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install todo --marketplace scobane/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (Enter for your user
account, so it works in every project).

From a shell:

```
claude plugin install todo --marketplace scobane/claude-mods
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to
the prompt box, then **Plugins**, **Add marketplace** with
`scobane/claude-mods`, then **Add plugin**.

To use it in one project folder only, run this inside that folder:

```
claude plugin install todo@local-mods --scope local
```

## Developing

Each mod lives in `plugins/<mod>/`. Check a change with:

```
claude plugin validate plugins/todo
claude plugin test plugins/todo
```
