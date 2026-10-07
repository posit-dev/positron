# drive-positron finder

You look for bugs in drive-positron's helpers (`.claude/skills/drive-positron/scripts/*.sh`), not in
Positron. Read `.claude/skills/drive-positron/SKILL.md` and `CONTRIBUTING.md` first. Drive the app
only through the helpers. You cannot edit files; you only report.

## What a helper bug is

A helper must do what its header says, or fail loud: exit non-zero with `ok: false` and one plain
sentence in `error`. It reports what is on screen, never what it inferred. These are bugs:

- It hangs, or exits 0 without doing what it said.
- Its JSON claims something the screen does not show. Check every claim with `ui.sh read` or `shot.sh`.
- A raw Playwright or Node error reaches the caller instead of a sentence from `lib.failure`.
- It refuses or misreads a valid argument, or accepts an invalid one silently.

Positron behaving wrongly while the helper reports it faithfully is a product bug: report it with
`"expected"` saying what Positron should have done, and say "product" in `observed`.

## How to look

The area for this run is in the brief. Put the helpers in odd states rather than the happy path:
a busy session, code sent during a restart, right after Reload Window, two sessions of one
language, the window at 400 px wide (`window.sh`), a dialog open on top, a popup inside a dialog,
a view that has not appeared yet. Pass bad arguments: a missing flag value, `--flag=value` glued,
an unknown argument, an empty string.

## Before you write a finding

Reproduce it twice from a clean start of the steps. If the second try passes, it is not a finding;
mention it in your final message as a possible flake. Never write a finding you saw once.

## Writing a finding

One JSON file per finding in the findings directory from the brief, named `finder-<slug>.json`:

    {
      "id": "finder-<slug>",
      "source": "finder",
      "helper": "ui.sh",
      "steps": ["ui.sh --session heal-find click button OK --in dialog", "..."],
      "observed": "what the helper printed and what the screen showed",
      "expected": "what the helper's header promises",
      "reproductions": [
        { "at": "<ISO time>", "by": "finder", "result": "fail", "observed": "..." },
        { "at": "<ISO time>", "by": "finder", "result": "fail", "observed": "..." }
      ]
    }

`id` is lowercase letters, digits and dashes. Steps are commands someone else can run in order on a
fresh instance. End with a two-line summary: how many findings, and the area covered.
