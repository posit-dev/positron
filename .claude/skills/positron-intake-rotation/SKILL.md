---
name: positron-intake-rotation
disable-model-invocation: true
description: Work Positron intake rotation duty - triage the no-status issue queue, discussions nobody at Posit has replied to, and Positron Escalations (PSTRNESC) Jira tickets that sit with engineering. Produces a ranked daily worklist, then drills into one item end to end (research, duplicate and upstream checks, optional repro, drafted response, and the label/status/comment writes on approval).
---

# Positron intake rotation

Get incoming issues, discussions, and support tickets ready for the weekly triage
meeting. Intake's job is not to prioritize or schedule -- it is to make sure nothing is
dropped, and that whatever reaches triage is actionable.

The team process lives on the wiki's
[Intake Rotation](https://connect.posit.it/positron-wiki/intake-rotation.html) page.
This skill is the operational version of it. If the two disagree, the wiki wins -- open
a PR here to bring the skill back in line.

## Usage

```
/positron-intake-rotation                    # sweep: ranked worklist across all three sources
/positron-intake-rotation --fast             # quick re-check later in the day
/positron-intake-rotation 15693              # drill into one issue
/positron-intake-rotation d15526             # drill into a discussion (d-prefix)
/positron-intake-rotation PSTRNESC-15        # drill into a support ticket
```

## Prerequisites

- `gh`, authenticated with access to `posit-dev`. Everything GitHub-side runs through it.
- The Atlassian connector (MCP), for support tickets. Without it, say so once, point the
  person at the [Positron Escalations board](https://positpbc.atlassian.net/jira/core/projects/PSTRNESC/board),
  and carry on with the GitHub side.
- Optional: read access to the private `posit-dev/assistant` repo, for AI-related
  duplicate searches. See `references/upstream-and-assistant.md` for the fallback.

## Approval model -- read this before doing anything

**Nothing user-visible goes out without showing the exact text and getting an explicit
go-ahead.** Not a summary of the comment. The comment.

Requires approval, per item, full text shown first:

- comments on issues and discussions
- closing an issue, including as duplicate
- creating an issue from a discussion or a support ticket
- retitling an issue
- Jira comments, Zendesk-tab replies to Support, status moves like `With Support`

Requires approval but batchable ("apply the metadata you proposed"):

- labels, issue type, project `Status` -> `Triage`

No approval needed: all reads. The queue, issue bodies, comments, duplicate searches,
upstream searches, assistant-repo searches, Jira ticket details.

Also gated: **reproduction**, because it launches an app on the person's machine.
Propose the recipe, let the person choose.

Do not batch a write across items the person only approved for one item. When unsure
whether something counts as user-visible, treat it as if it does. If the person says
they will post something themselves, hand over the draft and stop -- do not also post it.

### How to render a draft so it survives copy-paste

Drafts get copied into the GitHub comment box by hand often enough that the rendering
matters. Two things silently destroy the markdown on the way:

- **Blockquote prefixes travel.** Wrapping a draft in `> ` to set it off visually means
  every line carries a `> ` when it is copied, so GitHub renders the whole comment as a
  quotation, and any `##` headings inside it stop being headings.
- **Copying rendered chat loses the source characters.** The chat surface renders
  markdown, so a selection taken from it yields the display form: `**bold**` arrives as
  `bold`, `` `code` `` loses its backticks, tables lose their pipes.

So: **put every drafted comment in a fenced code block tagged `markdown`, using a
four-backtick fence.**

````
````markdown
Comment text goes here, with its **bold**, `backticks`, ## headings,
tables, and any ```json fenced blocks of its own, all intact.
````
````

Four backticks, not three, because drafts routinely contain their own three-backtick
blocks (a `settings.json` snippet, a command to run). A three-backtick outer fence gets
closed early by the first inner one and the rest of the draft escapes as prose. This is
verified behavior on GitHub's own renderer, not a precaution.

Do not put the draft in a blockquote, and do not add commentary inside the fence. Notes
about the draft go outside it, in normal prose.

The higher-fidelity path, when the draft is long or the person wants to edit before
posting: write it to a temporary file (outside the repo), verify it is ASCII, tell the
person where it is so they can open and edit it, and post with
`gh issue comment --body-file`. That file is the exact bytes that get posted, so nothing
is lost in transit. Prefer this for the two-comment split, where there are two distinct
blocks to keep straight.

## 1. Sweep

From the repo root:

```bash
node .claude/skills/positron-intake-rotation/scripts/sweep.ts
```

About a minute for a complete scan of all open issues and discussions (the two page
through GitHub in parallel). It emits a verdict line, then the issue queue bucketed by
what each item is waiting on, then discussions needing a reply. If a queued issue
cannot be loaded, the report lists it as such rather than failing; check it by hand.

Flags: `--fast`, `--json`, `--no-discussions`, `--discussion-days N`,
`--stale-days N`, `--fast-clean-pages N`.

### What counts as a discussion needing attention

**No Posit reply anywhere in the thread.** Not "the user had the last word" -- those
are very different sets (21 vs 186 repo-wide as of Aug 2026), and a thread where we
answered and the reporter wrote back has already been handled.

Two details that are easy to get wrong:

- **Check nested replies, not just top-level comments.** Team answers often land as
  replies inside a thread. Missing them inflated the count by a third on its own.
- **A community-accepted answer counts as resolved** even with no Posit reply, so
  `isAnswered` threads are excluded.

Because the team always has someone on rotation, the recent end is normally empty and
the real list is a couple of items at most. The sweep splits them: anything from the
last 30 days is the work; the older never-answered tail is shown separately and is
mostly stale feature wishes nobody is waiting on. Do not treat a 500-day-old unanswered
Feedback post as urgent because it appears on the list.

### `--fast`: the re-check mode

**About 10 seconds instead of a minute.** The intended pattern is one complete sweep to
open the session, then `--fast` for every re-check after that.

That is not just a speed preference, it is why the mode is sound: new issues get the
newest numbers and new discussion activity sorts to the top, so **anything that arrives
after your full sweep lands exactly where `--fast` looks.** The full sweep already ruled
out an old untriaged straggler, so the one risk `--fast` carries is retired for the day.

Two different mechanisms, and only one is a heuristic:

- **Issues -- heuristic.** Pages newest-first, stops after 3 consecutive pages (300
  issues) with nothing unstatused, since untriaged issues cluster at the new end. It is
  a partial scan and says so, including how far back it reached. Tune with
  `--fast-clean-pages N`.
- **Discussions -- exact.** Results come back ordered by last update, and `updatedAt` is
  always at least the last comment date, so once a page falls outside the window every
  remaining discussion does too. Stopping there loses nothing. Only the older backlog
  age-band counts go uncomputed.

What `--fast` deliberately is **not**: a filter on `updatedAt`. A recency window on
"last touched" would exclude the `gone-quiet` bucket by construction, since those are
precisely the items nobody has touched recently.

Residual gap worth knowing: if someone *clears* the Status on an old issue mid-day,
pushing it back into the queue, `--fast` will not reach it. Rare, and a full scan next
session catches it.

Run the complete scan at least once per session before treating the queue as whole.

The buckets are the point. An empty `Status` field means very different things:

| Bucket | Meaning | Action |
|---|---|---|
| `user-replied` | the reporter has the last word after we engaged or set `info needed` | re-assess; drop `info needed` if set |
| `untouched` | nobody from the team has commented | full triage |
| `needs-status` | team engaged and has the last word, no `info needed`, `Status` still empty | probably just needs `Triage` |
| `waiting-on-user` | `info needed` set, the reporter has not answered | **no action** -- tracking only |
| `gone-quiet` | `info needed`, silent past the threshold | propose closing |

"The reporter" means the issue's author. A +1 or a bot comment from someone else does
not count as an answer, so it leaves the issue where it was. Silence for `gone-quiet` is
measured from our last comment, or from the last activity if `info needed` was set
without one.

`waiting-on-user` is not work. A queue that is entirely `waiting-on-user` is a quiet
day; say so rather than walking the person through six items they cannot act on.

### Then add Jira

The script cannot reach Jira (MCP is not available to subprocesses). Query it directly:

```
project = PSTRNESC AND statusCategory != Done ORDER BY updated DESC
```

`PSTRNESC` is the **Positron Escalations** board. Positron tickets used to live in the
shared `IDEESC` project behind a `Positron` label; by early Oct 2026 they had all moved to
`PSTRNESC` (new keys, same workflow), so querying `IDEESC` now returns nothing and
looks like a quiet day. The wiki's Intake Rotation page is the source of truth for where
tickets live; if this query ever returns zero, check the board link there before
believing it.

Then one straggler check, since a ticket escalated to the shared board without the
`Positron` label never moves over:

```
project = IDEESC AND statusCategory != Done AND summary ~ "Positron" ORDER BY updated DESC
```

Anything it finds is not ours to work in place. Report it in one line so Support can
move it to `PSTRNESC`.

Use `cloudId: positpbc.atlassian.net`. **Request narrow `fields` and do not request
`description`** -- these tickets carry enormous Zendesk-relay descriptions, thousands of
tokens each. `summary`, `status`, `priority`, `labels`, `created`, `updated`, `assignee`
is enough for the worklist. Pull the description only on drill-in.

### Bucket Jira by status, not by priority

**Status decides whose problem it is. Priority only orders within that.** A High
ticket sitting in `With Support` is not work; ranking it above an actionable item is
the same mistake as treating a `waiting-on-user` issue as work.

The `PSTRNESC` workflow has exactly four non-closed statuses (verified Oct 2026, the
same set `IDEESC` used):

| Status | Category | Whose | Treatment |
|---|---|---|---|
| `With Engineering` | In Progress | **ours** | **The state that matters.** Actionable, rank by priority. |
| `Open` | To Do | ours | Newly arrived, not yet routed. Actionable. |
| `With Support` | In Progress | Support's | **Tracking only.** They move it back when we need to act. |
| `Hold` | In Progress | blocked | Paused on a dependency or missing info. Tracking only. |

So the actionable set is `status IN ("With Engineering", "Open")`. Do not flag a
`With Support` ticket as needing attention, even if it is High priority, recently
updated, or assigned to the person on rotation -- the ball is genuinely not in our
court, and Support will transition it back.

Report the `With Support` and `Hold` counts as one line of context, not as worklist
entries.

Useful when drilling in: the transition that replies to Support is named
**`Notify Zendesk Support`**, and it lands the ticket back in `With Support`.

### Rank and present

One ranked list, not three. Order:

1. Jira tickets in `With Engineering` or `Open`, highest priority first
2. `user-replied` issues (someone is waiting on us right now)
3. recent discussions with no Posit reply at all
4. `untouched` issues, oldest first
5. `needs-status` issues
6. `gone-quiet` issues
7. off-board issues, if the scan found any

Everything waiting on somebody else -- `waiting-on-user` issues, `With Support` and
`Hold` tickets -- is summarized in a single line, not ranked. If nothing lands in the
list above, say the day is quiet instead of padding it with items that cannot move.

Keep it to one line of context per item plus a proposed disposition. The worklist is
for deciding what to work, not for reading everything.

## 2. Drill in

For one item:

1. **Read it fully** -- body and all comments. For Jira, pull the description now, and
   check the Zendesk link for context that never made it to the ticket. Also read the
   ticket's thread in `#positron-support-escalations`: the team keeps ticket discussion
   there, and every ticket update gets posted there too. Point the person at Connect Bot
   in Slack for a summary of the full customer conversation (it reads Jira and Zendesk;
   you cannot reach it from here).
2. **Run the decision tree** in `references/decision-tree.md`. First match wins, and it
   leads with security/spam so those never get a public reply.
3. **Research**, in cheapest-first order:
   - duplicate search across open and closed issues plus discussions
   - already-fixed search: merged PRs and recently closed issues in that area
   - upstream VS Code, when the area is upstream-owned -- the search recipe in
     `references/upstream-and-assistant.md` matters, naive multi-word search there
     silently returns nothing
   - all three assistant repos, for anything AI-related
4. **Repro** if it is a candidate: propose the recipe from `references/repro.md`, get a
   yes, then run it. Be precise about which build tier the result came from.
5. **Draft the response** using `references/voice.md`. Explain the mechanism, ask
   numbered specific questions, put workarounds under their own heading. When the
   drill-in produced a real mechanism -- a root cause, a file and line, a regression
   window -- draft **two** comments: one for the reporter, one for triage, prefaced
   as the team's analysis. `voice.md` has the split and the exact preface.
6. **Propose the writes** as a concrete list, then execute the approved ones. When
   picking area labels, check the real names with
   `gh label list --repo posit-dev/positron --limit 500` rather than guessing.

Report what actually happened, including the parts that did not work. If a repro was
inconclusive, the comment says so.

## Hard rules

- **Never name a customer or their employer in a public issue or discussion.** Ticket
  summaries carry company names in parentheses; strip them.
- **Never transfer Posit Assistant items.** Label `area: assistant`, prep for triage.
  That call gets made later, by triage.
- **Security, spam, or Code of Conduct problems get no public reply.** Raise them in
  `#positron-dev`.
- **Do not set Milestone, Priority, or assignees.** Intake's output is
  `Status = Triage`. Prioritizing is the triage meeting's job.
- **Do not promise a release, a milestone, or a date.**
- Files a reporter will not post publicly go to `positron-support@posit.co`.
- ASCII only in every drafted response. No em-dashes, no smart quotes, no emoji.

## When to ask a human instead

Intake is allowed to not know. Reach out in `#positron-dev` (or
`#posit-assistant-dev` for AI) rather than guessing when the issue needs domain
knowledge you do not have, when it might be a security problem, or when the right
disposition is genuinely unclear. Say so in the worklist rather than inventing a
confident-sounding disposition.

## Handoff

Rotation is Mon-Fri. If an item bleeds into the following week, the convention is to
keep following it yourself until it reaches triage. If that is not possible, hand it off
explicitly to the next person -- do not just leave it in the queue.

State is derived from GitHub on every run: labels, comment authors, and timestamps are
the source of truth. There is no local state file to go stale. That also means anything
that lives only outside GitHub (a Slack ping, a promise made on a call) is invisible to
the sweep -- mention it explicitly when handing off.

## References

- `references/decision-tree.md` -- branch order, field vocabulary, what "done" means
- `references/voice.md` -- response patterns, all distilled from real repo comments
- `references/upstream-and-assistant.md` -- the search recipes that actually work
- `references/repro.md` -- build tiers and what each result proves
- `scripts/sweep.ts` -- the queue and discussion scan behind step 1
