An automated test run found the bugs below. Your job is compression, not summarization: extract the user-visible failure from each finding's record and compress it into a short GitHub issue title and one opening sentence. The goal is a concise engineer filing a bug for another engineer, not an AI summarizing a test run.

The record is source material, not prose to preserve. Rewrite freely, keeping only verified facts. The run's own steps to reproduce and its evidence appear below what you write, unchanged.

## Rules

1. **One sentence is the default.** Use a second only when the bug cannot be understood without it.
2. **Lead with the visible failure.** Start with what is wrong. Add the condition that triggers it only when it is needed to tell this bug apart.
3. **State the expected behavior only when it adds information.** If the right behavior is obvious from the failure, leave it out.
4. **Do not narrate the test.** No harness actions, waits, checks, retries, setup, investigation history or reasoning.
5. **Prefer concrete product behavior over abstract language.** Avoid: "the application", "the user", "when attempting to", "it was observed that", "results in", "does not behave as expected", "the expected X is not displayed", "successfully", "upon", "following", "the interface", "causes" (when the run did not establish cause), and "fails to" (when something more concrete is available).
6. **Do not broaden the bug.** Use only what the run saw. Do not infer impact, root cause, scope, frequency or who is affected.
7. **Keep exact details exact.** Keep numbers and on-screen text exactly as written. Put data values in backticks in the summary, not in the title. Name UI elements the way a user sees them, not by code names.
8. **Titles are short but specific.** The issue title becomes `<feature>: <your title>`, so leave the feature out. Keep the condition that narrows the bug when it matters: a size, a file type, a state, a platform, a specific action, or first-versus-second attempt.

## Bad and better

Bad: "When attempting to browse for a folder, the application does not display the expected folder picker on the first click."
Better: "The first Browse... click does nothing; the folder picker opens on the second click."

Bad: "It was observed that pressing Enter initially fails to perform the expected action."
Better: "Pressing Enter on the New Folder Created dialog does nothing until focus has moved with Tab."

Bad: "The folder picker fails to open as expected, which may cause confusion for users."
Better: "The first Browse... click opens no folder picker."

Good:
- "The toolbar shows the '2 missing packages' badge twice instead of once."

## Reply

Reply with only this. First a RESULT line: one or two sentences for the top of the report, saying what works, then in bold what is broken, in the same words as your titles. Then a block for every finding, in order:

```
RESULT: <the Result, without the **Result:** label>

=== Finding <N>
TITLE: <title>
SUMMARY: <the opening sentence>
WHERE: <leave empty unless the bug needs a particular OS, the web build, or a setting turned on. A language, library or condition already in the title or opening never goes here>
```

`<N>` is the number in the finding's `### Finding N:` heading.

## Result

{{RESULT}}

## Findings

{{FINDINGS}}
