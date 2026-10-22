# Intake decision tree and field vocabulary

Source of truth: the team wiki's `intake-rotation.qmd` and `issues.qmd` pages
(`posit-dev/positron-wiki`, published at https://connect.posit.it/positron-wiki/).
This file is the operational version: what to decide, and the exact field values to set.
If the two disagree, the wiki wins -- and update this file.

## Field vocabulary (get this right)

These are the real fields on the org project board, not invented ones.

| Thing | Where | Allowed values |
|---|---|---|
| `Status` | project #2 field | `Triage`, `Backlog`, `Up Next`, `In Progress`, `PR Ready`, `Done`. Empty = intake's queue. |
| Issue type | GitHub issue type | Usually `Bug` or `Enhancement` |
| Area / language | labels | `area: *`, `lang: r`, `lang: python`, `theme: *`, `os-windows`, etc. |
| Intake markers | labels | `info needed`, `duplicate`, `support` |
| Milestone | project / issue | Leave empty. Triage assigns it, not intake. |

Rules that are easy to get wrong:

- **Every triage-ready issue gets the `support` label** plus at least one area or
  language label. `issues.qmd` requires at least one label on every issue.
- **Do not set Milestone or Priority.** That is the weekly triage meeting's job.
  Intake's output is `Status = Triage`, not a prioritized issue.
- **Do not assign anyone.**
- New issues auto-add to project #2 reliably -- 0 misses across all 1813 open issues
  as of Aug 2026. If the sweep ever does report an off-board issue, add it manually,
  but treat it as surprising and worth a second look.

## Issues

Work the branches in order; the first match wins.

1. **Security vulnerability, spam, or Code of Conduct problem?**
   Do not reply publicly and do not engage with the content. Raise it in
   `#positron-dev`. Handled case by case.

2. **Posit Assistant / AI feature?**
   Label `area: assistant`, prep for triage as normal. **Do not transfer** to
   `assistant-feedback` -- triage decides that later. Research it across all three
   repos first (see `upstream-and-assistant.md`), and for info requests lead with
   the `AI: Create Diagnostic Report` ask (see `voice.md`).

3. **Duplicate of an existing issue or discussion?**
   Comment thanking them and linking the original. If certain, close as duplicate
   and add the `duplicate` label. If it is a judgment call, ask the reporter to
   confirm and let them close it. Cross-repo duplicates (assistant, ark, upstream
   VS Code) get **linked, not closed**.

4. **Actually an upstream VS Code issue?**
   Still ours to triage, but say so. See `upstream-and-assistant.md` for the search
   recipe. Link the upstream issue in the comment; do not close on that basis.
   Triage decides whether we track, work around, or wait upstream.

5. **Not reproducible, or missing information?**
   Comment with specific asks, add `info needed`, leave `Status` empty. The issue
   stays in the intake queue and the next sweep will surface it as waiting.

6. **Enough information to be triaged?**
   Label it (area/language + `support`), set the type (`Bug` / `Enhancement`),
   confirm the title actually describes the problem, then set `Status = Triage`.

### Retitling

A vague title costs the triage meeting real time. `column index` and
`port bindings don't appear` are both live examples. If the title does not say what
broke and where, propose a better one. It is a write action, so it needs approval
like any other.

## Assessing "enough information"

- **Bug:** can someone on the team reproduce it from what is written? Version, OS,
  and the runtime version are the usual gaps. The version block from the built-in
  issue reporter covers most of it when present.
- **Enhancement:** is the request specific enough to build or reject? "Make it
  better" is not. "Show the column index in the data viewer, like RStudio does" is.
- **Either way:** can the team act on it -- close, triage, or prioritize?

## Discussions

1. Security / spam / CoC -> same as issues, `#positron-dev`.
2. Assistant-related -> answer normally. Discussions skip triage entirely, so if it
   belongs with the AI Core team, drop a link in `#posit-assistant-dev`.
3. Duplicate of an existing issue or discussion -> link it.
4. Answerable question -> answer it, or link the doc that does.
5. Contains a real, actionable bug or request -> create an issue from it
   (**Create issue from discussion**, or copy the content over), prep that issue for
   triage, and comment on the discussion with a link to the new issue.

Do not spend energy managing discussion status. We rely on the opener to mark an
answer or close it. We do not track our work there.

## Support tickets (Jira `PSTRNESC`, the Positron Escalations board)

**Check status before priority.** Status says whose court the ball is in; priority only
orders the tickets that are actually ours.

- `With Engineering` -- ours, and the state that matters. This is the working set.
- `Open` -- newly arrived, not yet routed. Also ours.
- `With Support` -- Support's. **Not work.** They transition it back when we need to
  act again, so it needs no watching, regardless of priority or assignee.
- `Hold` -- paused on a dependency or missing information. Not work.
- `Closed` -- done.

Within the actionable set (`With Engineering`, `Open`): **urgent first**, then by
priority weight, highest first.

- Duplicate of a known issue -> share the issue link with the customer, plus any
  workaround and what we honestly know about timing.
- Missing information -> ask, via the right channel (below).
- Enough information -> create a public issue, prep it for triage, and comment on
  the ticket with the issue link.

**Never name the customer, their company, or paste customer-identifying detail into
a public issue or discussion.** Ticket summaries carry company names in parentheses;
strip them when creating the public issue.

Channels on a Jira ticket:

- **Comment field** -- internal, for devs. Support generally does not read it.
- **"Zendesk Support"** (from the *More* dropdown) -- reaches Support, who relay to
  the customer. The workflow transition for this is named **`Notify Zendesk Support`**,
  and it lands the ticket in `With Support` on its own.

Moving a ticket to `With Support` is how you hand it back. Do that once you have
replied and the next move belongs to Support or the customer -- it takes the ticket out
of the working set, and they will return it if we are needed again.

Zendesk itself often holds context that never made it to Jira. Worth having access.
And a 20-minute call with the customer frequently beats a week of ticket comments.

## What "done" looks like for intake

An issue leaves intake in exactly one of these states:

- `Status = Triage`, labeled, typed, with a title and body the triage meeting can act on
- closed as a duplicate, with the original linked
- closed by the reporter because it turned out to be resolved or user error
- labeled `info needed`, waiting on the reporter, still in the queue
