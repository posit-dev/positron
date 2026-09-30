# The SQL stack: which PR owns what

**This file is temporary and must not reach `main`.** It is the bottom commit of the SQL
stack so that every branch above inherits it. Drop it before the first PR merges; see
[Removing this file](#removing-this-file).

The SQL editor feature was written as one 12.6k-line branch and split into four stacked PRs.
Each PR is reviewed as the diff against the branch below it, so **branch N must stay a true
ancestor of branch N+1**. The cost of getting that wrong is not a merge conflict, which you
would notice. It is the same change being written twice in two branches, which you do not
notice until the diffs contradict each other.

## The stack

Bottom first. Each branch has its own Orca worktree at
`~/orca/workspaces/positron/<branch suffix>`.

| # | Branch | What it is |
|---|---|---|
| 1 | `sclark/sql-1-core-connections` | Core + API only. Lets an extension read the user's data connections, open one, and reveal a row in the Connections pane. No SQL anywhere. |
| 2 | `sclark/sql-2-analyzer` | The `sql-analyzer` Rust crate, its committed wasm, the `positron-sql` extension skeleton, and statement ranges. Knows nothing about connections. |
| 3 | `sclark/sql-3-support` | Everything the editor offers against a connection's schema: completions, diagnostics, links, hover, references, the dialect and status bar, and per-file connection scoping. |
| 4 | `sclark/sql-4-core-sessions` | Putting a connection into a running session and querying it: the session half of the core API, the seven `positron-data-driver-*` extensions, and cmd+enter execution (including the ggsql SQL-console route). |

PR 5 no longer exists. Execution was folded into PR 4 because the two were too similar to
review apart, so **`sql-4` owning `execution.ts` is correct**, not drift.

## Where does my change go?

| If you are changing... | It belongs in |
|---|---|
| Rust in `sql-analyzer/`, the wasm, or `analyzer.ts` | **2** |
| Statement ranges (`statementRange.ts`) | **2** |
| Completions, diagnostics, hover, links, references, schema | **3** |
| The status bar, dialects, or which connection a file is written against | **3** |
| A `positron-data-driver-*` extension | **4** |
| Generating connection or query code | **4** |
| cmd+enter, `sql.runStatement`, choosing a session or language | **4** |
| `src/vs/**` or `positron.d.ts` | **1 or 4** -- see below, this is the sharp edge |

## The core/API split between 1 and 4

Twenty-three files are touched by two PRs. Most are harmless, but the entire
`positronDataConnections` cluster is deliberately cut in half, and the halves are easy to
confuse because they sit in the same files:

- **PR 1** owns *reading and showing* connections: listing them, opening one, revealing a row
  in the pane, and the DTOs and service methods that serve those.
- **PR 4** owns *using* a connection from a session: binding one to a variable in a running
  R or Python session, the Connect With flow, and `generateQueryCode`.

Files split this way, all in `src/vs/workbench/**/positronDataConnections/**` plus
`src/positron-dts/positron.d.ts`, the `extHost`/`mainThread` pair, and their vitest files.
**Before adding a method to any of them, ask whether it is answered without a session. If
yes it is PR 1; if it needs a session, it is PR 4.**

Other shared files, for reference:

| File | Touched by | Split |
|---|---|---|
| `positron-sql/src/extension.ts` | 2, 3, 4 | skeleton / providers / execution commands |
| `positron-sql/package.json`, `package.nls.json` | 2, 3, 4 | same order |
| `positron-sql/src/selection.ts`, `test/selection.test.ts` | 3, 4 | file's connection / remembered language |
| `positron-sql/src/test/schema.test.ts` | 3, 4 | schema tests / `supportedLanguageIds` on the fake |
| `positron-sql/src/statementRange.ts`, `src/test/support.ts` | 2, 3 | ranges / scoping |
| `scripts/test-integration*.sh`, `build/gulpfile.extensions.ts`, `test-tag-paths-map.json` | 2, 4 | registering `positron-sql` / the driver extensions |

## Rules that keep the stack straight

1. **Make the change in the worktree of the PR that owns it.** Not in whichever worktree you
   happen to have open. The stack propagates downstream on restack; it never propagates up.
2. **Never re-author a downstream fix.** If PR 3 needs a change that belongs to PR 2, make it
   on `sql-2` and restack. Copying it into `sql-3` creates two divergent commits with the
   same intent, which is exactly how this stack broke once already.
3. **Restack with `~/.orca/restack-sql.sh`**, not by hand and *not* with
   `git rebase --update-refs` -- that silently skips branches checked out in another
   worktree and still exits 0, leaving the middle of the chain behind. `--check` prints the
   chain's shape without changing anything.
4. **`npm run compile` at the tip you touched** before pushing. A per-extension
   `npx tsc -p ./` does not catch a type break that spans two PRs.

## Known blocker

`extensions/positron-sql/src/completion.ts` iterated `analyzer.sources()` directly while that
method had changed to return a `Sources` object (`{sources, locals, opaque, origin}`), so the
compile failed with TS2488 at PR 3 and everything above it.

A `WIP:` commit on `sql-3` applies the `.sources` fix along with `ORDER BY` alias handling in
`references.ts`. **It has not been compiled or tested.** Verify it, then amend it into a real
commit before PR 3 goes up.

## Removing this file

It is the single bottom commit of the stack, so removing it is one command:

```sh
~/.orca/restack-sql.sh --drop-notes
```

That drops the commit from `sql-1` and restacks the other three onto the base it was sitting
on. Until then, `restack-sql.sh --check` prints a reminder that this file is still in the
stack, so it cannot be forgotten silently.
