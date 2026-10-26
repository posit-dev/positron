# Reproduction

Reproduction is opt-in per item. The sweep flags candidates and drafts a recipe; the
person picks which ones to actually run. Never launch anything unprompted.

## Do the free checks first

Every one of these is a read, and any of them can make a launch unnecessary.

1. **Version delta.** The sweep parses the reported version out of the issue-reporter
   block. Compare it to what is current. A report against a version several releases
   back may already be fixed.
2. **Already fixed?** Search merged PRs and recently closed issues for the same
   surface. If a fix landed after the reported version, that is the answer -- and it
   is a better answer than a repro attempt.
3. **Duplicate search** across open and closed issues plus discussions.
4. **Upstream check** when the area is upstream-owned (see `upstream-and-assistant.md`).
5. **Is it even plausible?** A "very short body" or "no version info" flag on the
   sweep line usually means the next step is `info needed`, not a repro.

## Know which build you are on. It changes what a result means.

Three tiers, and they are not interchangeable:

| Build | What it is | How to drive it |
|---|---|---|
| **Stable release** | what reporters are almost always on | download from the releases page; no automation |
| **Daily** | the latest daily build, if the person has one installed (Help > About shows which build) | launch the installed Positron directly |
| **Dev build (main)** | this repo's checkout, furthest ahead | the repo's `drive-positron` skill (CDP-driven, disposable profile) |

Ask which builds the person actually has before proposing a tier. Not everyone keeps a
daily installed, and some run a stable release as their everyday app.

`drive-positron` drives the **dev build only**. It is the automatable option, so it is
the default -- but be precise about what its result proves:

- **Reproduces on main** -> live bug, still present at the tip. Strongest possible
  triage input. Say which build you used.
- **Does not reproduce on main** -> do **not** write "cannot reproduce". It may well be
  fixed since the reported version. Check what changed in that area, then either say
  "this looks fixed as of <build>, can you try the latest daily?" or fall back to a
  closer build before concluding anything.
- **Reproduces on the daily too** -> narrows the fix window usefully.

Only chase an exact-version repro on a stable download when the version delta is the
crux of the question. It is slow and rarely changes the triage outcome.

## Before invoking drive-positron

Read its own preamble. It runs `build/lib/preLaunch.ts` against the real checkout and
can delete or re-download `.build/builtInExtensions`, `.build/electron`, and run
`npm run compile` into `out/` -- which competes with the build daemons. An interrupted
pre-launch leaves the normal dev build unable to start. Repair with:

```bash
npm run download-builtin-extensions
npm run electron
```

Do not interrupt it while it reports that pre-launch is running. If the checkout is
mid-task or the daemons are busy, say so and offer the installed daily instead.

## Writing the recipe

Extract from the issue body, and state each explicitly so the person can sanity-check
before agreeing to run it:

- build tier and why that one
- language runtime and version, if the bug is R- or Python-specific
- workspace or file setup needed
- the numbered steps, taken from the reporter's own words where possible
- what specifically would count as reproduced, and what would count as not

If a step cannot be reproduced from what is written, that is the finding. It goes
straight into an `info needed` comment naming the missing step.

## Reproducing in stock VS Code

Worth doing when the area is upstream-owned and a matching upstream issue was found or
suspected. "This reproduces in stock VS Code too" is the single highest-value sentence
intake can add to an upstream-flavored issue -- and "it does not reproduce in VS Code"
is nearly as useful, because it means we broke it.

Only claim either one after actually running it. Never infer it from the code.

## What cannot be reproduced here

Say so plainly rather than guessing:

- Posit Workbench, Snowflake, and remote-session-specific behavior
- OS-specific bugs on an OS you are not running (`os-windows` on a mac, and so on)
- anything needing customer data, a corporate proxy, an enterprise SSO setup, or a
  filesystem filter driver
- licensed or air-gapped enterprise configurations

For these, the value intake adds is a precise information request and a clear note in
the issue about why it was not reproduced locally.

## Recording the result

Whatever happens, the outcome becomes the comment draft:

- reproduced -> state the build and the exact steps that worked; prep for triage
- not reproduced -> state the build, the steps tried, and where your setup differed
  from theirs (the wiki's own example does exactly this: "the one difference I see
  between my setup and yours is that you are using OneDrive")
- blocked -> state what was missing, and ask for it
