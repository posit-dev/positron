# Cross-repo research: upstream VS Code and Posit Assistant

Two research passes that answer questions intake cannot answer from the Positron repo
alone: "is this even ours?" and "what do we already know about this assistant bug?"

---

# Upstream VS Code

Positron forks VS Code, so a meaningful share of reports are upstream behavior. Saying
so is one of the most valuable things intake can add.

## When to run this pass

Do not run it on everything. It fires when:

- the issue's area maps to upstream territory: editor, terminal, tasks, debug, SCM
  and git, extensions and the gallery, settings sync, remote and SSH, dev containers,
  core notebook editing
- the body names a stock VS Code feature or setting
- there is a stack trace or file path -- run `./scripts/file-origin.sh <file>` from the
  positron repo to settle ownership definitively

Skip it for anything Positron-only: console, sessions, variables pane, data explorer,
plots, connections, the R or Python runtimes, ark, the assistant.

## The search recipe

GitHub ANDs every term across ~330k issues, so naive multi-word search fails silently.
`terminal shell integration not working windows` returns **zero** results. This works:

```bash
gh search issues --repo microsoft/vscode --match title \
  --updated ">2025-06-01" --sort updated --limit 5 "shell integration"
```

Rules that make the difference:

- **2 or 3 terms, maximum.** More terms means an empty result, not a narrower one.
- **`--match title` first.** Body search needs 2 terms at most or it returns nothing.
- **Filter by `--updated`.** Roughly 14 months back.
- **`--sort updated`, never `--sort comments`.** Sorting by comments surfaced four
  proxy issues from 2015-2017 on a 2026 report. Useless.
- **Search both states.** Upstream closes duplicates with the answer in them.

Fall back to a 2-term body search only if the title pass comes up empty.

## What to do with a hit

- Link the upstream issue in the comment. Hedge if you are not certain -- the repo
  already does this: "potentially related upstream issue: <link>?"
- **Do not close the Positron issue** because upstream owns it. Triage decides
  whether we track, work around, or wait.
- Prep for triage as normal, with the upstream link as context.

The highest-value sentence intake can produce is "this reproduces in stock VS Code
too" -- but only say it if you actually checked. See `repro.md`.

---

# Posit Assistant

Three places to look, and none of them require a clone.

| Repo | Visibility | Volume | What is in it |
|---|---|---|---|
| `posit-dev/positron` | public | `area: assistant` | reports that came in through Positron |
| `posit-dev/assistant` | **private** | ~350 open | the actual assistant code and its issues |
| `posit-dev/assistant-feedback` | public | ~35 open | older public feedback repo, winding down but still active |

`assistant-feedback` is easy to misread as dead -- its last code push was May 2025.
The issues are live. Search it.

## Locating the assistant code (optional)

Resolution order. Never hardcode a path -- this skill should work for teammates too.

1. `POSITRON_ASSISTANT_REPO` if set.
2. Sibling of the positron repo root, verified by remote:
   ```bash
   root=$(git -C . rev-parse --show-toplevel)
   cand="$root/../assistant"
   git -C "$cand" remote get-url origin   # must contain posit-dev/assistant
   ```
3. **GitHub API only. This is the default and it is enough.**

Intake almost always needs *issues*, and `gh` reads `posit-dev/assistant` issues
without any clone. The local clone only helps for grepping code or log strings. A
teammate with no clone loses nothing that matters here; a teammate without repo
access gets a clear message and falls back to positron + assistant-feedback.

If `gh repo view posit-dev/assistant` returns 404, they do not have access. Say so
once, do not retry, and carry on with the two public repos.

## Search pass

Fan out across all three, then report what you found and where:

```bash
gh search issues --repo posit-dev/assistant --limit 5 --sort updated "bedrock region"
gh search issues --repo posit-dev/assistant-feedback --limit 5 --sort updated "<terms>"
gh search issues --repo posit-dev/positron --limit 5 --sort updated \
  --label "area: assistant" "<terms>"
```

Same term discipline as upstream: 2-3 terms. These repos are small enough that body
search works fine, unlike microsoft/vscode.

## Routing

- Label `area: assistant`, prep for triage, **do not transfer.** Triage decides
  whether it stays in Positron or moves to assistant-feedback.
- Discussions skip triage entirely, so an assistant discussion that the AI Core team
  should see gets a link dropped in `#posit-assistant-dev`.
- A duplicate that lives in `posit-dev/assistant` gets **linked, not closed** -- the
  reporter probably cannot even see that repo, so explain rather than just linking:
  "we track this internally as ..." with what it means for them.
- Posit Assistant is a separate release train from Positron. A fix landing in the
  assistant repo does not mean it is in the user's Positron yet, so do not imply it is.
