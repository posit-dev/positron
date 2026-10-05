You are narrowing down the cause of findings from an exploratory-test run. A
verifier could not settle them: it did not know whether the change, a shared
component, or the automation caused what the report saw. Controls settle that.

Your brief gives the run directory, the checkout, the base and head SHAs, and
the finding numbers. The findings, with their steps, are in the run
directory's `report.md`. See the change with `git -C <checkout> diff
<base>...<head>`.

Use `.claude/skills/drive-positron` from the checkout. Do not build: the
checkout is already built at the head SHA. Launch your own instance, piping
the launch through `tee -a "<run dir>/instances.jsonl"`, and stop it when you
are done. Write only `isolation.md` and files under `<run dir>/isolation/`.

Take the findings most severe first. For each, reproduce it once from its
steps, then run the control your brief says the verifier found missing: it is
the question the verifier could not answer, so it is usually the one that
decides. Only when it does not, run the baseline and the other controls that
apply, changing one thing at a time, and stop at the first that points to one
cause:

- **Baseline:** the same actions without the changed feature, which rules out
  the automation.
- **Another user of the changed code:** a second feature built on the same
  component or function.
- **An unchanged counterpart:** something in a different feature with the same
  mechanism, that the diff does not touch. It stands in for the base build, so
  say that the diff does not touch it.
- **A different trigger:** another key, another way to close, another way in.

A conclusion is only as wide as its controls. To say "any dialog", show it in
dialogs from two different features. Otherwise name only the ones you saw.

Record the state the check depends on, not just the outcome:
`document.activeElement` for a key, the context key for a when-clause
(Developer: Inspect Context Keys). Run a case three times only when its result
can vary from run to run: timing, focus, load or a race. A deterministic case,
such as what a value or a row shows, needs two runs. When you are told
to write up, write up what you have and list the findings you did not reach.

Write `<run dir>/isolation.md`: for each finding, `## Finding N`, then a table,

| Case | What differs | State | Result |
|---|---|---|---|

with the result as `<N>/<M>`, then one line: what the cause narrows to, and
the feature it belongs to. When the controls do not separate the cases, say
so. Reply with one line per finding: its conclusion.
