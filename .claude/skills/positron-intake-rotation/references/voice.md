# Response voice

Every pattern here is distilled from real intake comments by the team on the Positron
repo. Nothing here is invented. When in doubt, go read the last few `info needed`
comments on the repo and match them.

## The shape that actually gets used

1. `@user`, then one line of thanks. Not a paragraph.
2. What we already believe is happening, stated plainly -- often a mechanism, not a
   guess. This is the part that separates a good intake comment from a form reply.
3. Numbered, specific asks. Each one a command to run or a concrete observation.
4. Where useful, what a step would prove.
5. Workarounds under their own heading, best option first.
6. No promises about timing.

## Two comments, not one, when you found a mechanism

When intake turns up real technical detail -- a root cause, a file and line, a
regression window, a repro that contradicts the report -- split it into **two
comments** rather than one comment that serves neither audience.

**Comment 1, for the reporter.** What is happening and why, in their terms. No file
paths, no line numbers, no commit SHAs, no internal type names. Explain the mechanism
well enough that they can disagree with it, then the numbered asks and workarounds.
This is the shape above.

**Comment 2, for the triage team.** The evidence. File and line references, the
regression window and what rules it in or out, an evidence table when there is one,
what you did not verify, and any recommendation about how the issue should be handled
(a split, a retitle, a repo it really belongs in). Both comments are public, so this
one is scoped for the team, not private -- nothing sensitive goes in it either.

Preface comment 2 with a line naming who did the analysis, so a reader knows what
they are looking at and who stood behind it. The form in use:

> Triage notes. The analysis below is Claude's, run during intake and reviewed by me
> before posting.

Then say plainly which parts are verified and which are inferred. A drilled-in issue
usually ends with a confirmed reproduction, a well-supported cause, and an unverified
fix -- write exactly that, e.g. "Not verified: no fix was written or tested."

Name the build tier the repro ran on, every time. "Reproduced on the daily
2026.09.0-100" also tells triage the bug is not already fixed when that build is
newer than the reported one. See `repro.md`.

**When one comment is enough.** A duplicate link, an `info needed` ask, an answerable
question. If there is no mechanism to hand over, do not manufacture a triage comment.

## Openers

Real ones, in use:

- `@Freestyleyang , Thank you for the report!`
- `@tingtmu , Thanks for the report!`
- `Thanks for the report, @DE-code-V!`
- `Hi there! Unfortunately I'm not able to reproduce this on mac or on windows.`

Skip "Thank you for reaching out and for your interest in Positron." Nobody writes
that here.

## Explain the mechanism, do not just ask

This is the strongest habit in the repo. Compare a generic ask to what actually gets
posted:

> On Windows, Positron opens the file, truncates it, and then writes to it.
> `EBADF: bad file descriptor, write` means the file handle became invalid between
> the truncate and the write. The open and the truncate both succeeded, so the path
> is correct and the file exists. Something else invalidated the handle. A filesystem
> filter driver is the usual cause.

The reporter now knows what we think, can disagree, and can help. It also earns the
long, detailed replies -- reporters match the energy they are given.

Own our own bugs just as plainly:

> You are right that the extension supports Windows. The problem is on our side:
> by default Positron installs extensions through Posit's mirror of the Open VSX
> registry, and that mirror is only offering the very newest release of an extension.

## Asks are numbered and specific

Name the exact command, the exact menu path, the exact Output channel. Real examples:

```
1. Python version. `python -V`
2. How the environment was created - python -m venv, uv venv, conda/mamba, something
   else? And does it have pip in it (python -m pip --version)?
3. The output of `python -m pip list --outdated` run in that same environment from
   Positron's terminal. Does pandas appear at all, and at 2.3.3 or 3.0.5?
4. Anything in Output > Python mentioning "Failed to fetch outdated package versions"?
5. Are you behind a corporate proxy, or installing from a private package index?
```

```
5. Run _Developer: Set Log Level..._ and select Trace. Reproduce the error. Then
   attach the **Main** output channel.
```

Note what these are not: "please provide more information", "can you share your
logs", "what version are you on". Ask for the specific thing that discriminates
between the hypotheses.

When the specific thing is a report or a log, use the one the wiki maps to the area,
and link the user-facing doc rather than describing the steps yourself:

| Area | Ask for | Link |
|---|---|---|
| Runtime discovery, startup, performance | Runtime Startup Diagnostics Report | https://positron.posit.co/troubleshooting.html#runtime-startup-diagnostics |
| Posit Assistant, AI features | AI Diagnostics Report (see below) | https://positron.posit.co/troubleshooting.html#ai-diagnostics |
| Python or R execution | output logs | https://positron.posit.co/troubleshooting.html#python-and-r-logs |
| An extension | that extension's channel in the Output pane | -- |
| Anything else | Developer Tools console | -- |

Say what a step buys, when it is not obvious:

> Step 2 would tell you if a new empty file also fails to save, that the problem has
> nothing to do with R or usethis.

## Workarounds

Own heading, recommended first, honest about the cost of each.

```
## Workaround 1: point Positron at Open VSX directly (recommended)

This is the cleaner option, and extensions will still auto-update afterward.

1. Open the Settings UI (File > Preferences > Settings).
2. Search for "Extension Gallery Source".
...

Or in settings.json:

    "positron.extensions.gallerySource": "open-vsx"
```

Give both the Settings UI path and the `settings.json` key. State the downside
("This build will not auto-update"). Do not oversell.

## Assistant / AI issues

Lead with the one-command ask. On 2026.08 and later, **`AI: Create Diagnostic Report`**
collects versions, feature enablement, providers, non-default AI settings, and recent
trace/debug logs in one file, with no repro needed, and it works even when AI features
are off. For the chat itself, have them choose "Report and diagnostics bundle".

The privacy caveat is **required** whenever asking for chat logs, output channels, or
a diagnostics bundle:

> Note that exported chat logs and diagnostics bundles may contain private or
> sensitive information from your conversation history and session data. API keys,
> tokens, and custom header values are redacted from the diagnostic report, but base
> URLs and other connection settings are not.

The report does not cover custom instructions, skills, or MCP servers, so still ask
about those, plus what they were doing and screenshots of the full IDE.

Full field list: wiki `ai-assistant-faq.qmd#user-issues`.

## Duplicates

Thank them, link the original, and either ask them to confirm and close, or close it
yourself when it is not a judgment call. Never just slam it shut with "duplicate".

## Not reproducible

Say where you tried, so the reporter can spot the difference. This is what makes
`isabelizimm`'s reply work:

> Unfortunately I'm not able to reproduce this on mac or on windows. The one
> difference I see between my setup and yours, is that you are using a OneDrive, so
> it might be related to that.

## Hard style rules

- ASCII only. No em-dashes, en-dashes, smart quotes, or curly apostrophes. Plain
  hyphens and straight quotes. (Same rule as the codebase.)
- No emoji banners, no warning-siren glyphs, no bold-shouting.
- Backticks around commands, settings keys, file paths, and error strings.
- Do not promise a release, a milestone, or a timeline. "We are following up to get
  the mirror fixed" is as far as it goes.
- Do not name customers or their employers in public.
- Do not thank someone for their "valuable feedback". Just answer.
- When showing a draft for approval, wrap it in a four-backtick ```` ```markdown ````
  fence rather than a blockquote, so the markdown survives being copied into the
  GitHub comment box. See "How to render a draft so it survives copy-paste" in
  `SKILL.md`.
