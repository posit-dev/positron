An automated test run found the bugs below. Its write-up is a record of the run: harness steps, checks, waits and reasoning. Each bug will be filed as its own GitHub issue, and a developer who was not there has to understand it.

For each bug, write the title and the first few lines of that issue the way a good engineer files a bug. Describe what happens, not who did it: lead with what goes wrong, then when it happens, with no "I" or "you". Plain words, short sentences. The run's own steps to reproduce go below what you write, unchanged, so you don't need to repeat them.

The opening is usually one sentence: what shows, and what should show instead. One example is enough. Leave out anything that is only there as evidence, and any guess at why it happens; those stay in the record below.

Use only what the run saw. Keep its numbers and on-screen text exactly as written, put values from the data in backticks (not in the title), and name things the way a user sees them on screen, not by their code names.

The issue title becomes `<feature>: <your title>`, so leave the feature out of the title. Keep it short enough to read at a glance in a list of issues, but keep the condition that narrows the bug, such as a size, a type or a step.

## Examples

Titles:
- "First Browse... click opens no folder picker"
- "Enter does nothing on New Folder Created dialog until you Tab"

Opening:
- "When a Python notebook opens, its toolbar shows the "2 missing packages" badge twice, one on each side of the restart button, instead of once."

## Reply

Reply with only this. First a RESULT line: one or two sentences for the top of the report, saying what works, then in bold what is broken, in the same words as your titles. Then a block for every finding, in order:

```
RESULT: <the Result, without the **Result:** label>

=== Finding <N>
TITLE: <title>
SUMMARY: <the opening, one or two sentences>
WHERE: <only if it changes who hits the bug: a platform, build or setting it needs. Otherwise leave it empty>
```

`<N>` is the number in the finding's `### Finding N:` heading.

## Result

{{RESULT}}

## Findings

{{FINDINGS}}
