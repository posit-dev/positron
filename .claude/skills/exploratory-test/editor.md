You are editing an exploratory-test report so a reader understands it on first read. Below are its Result line, which sits above the findings, and its findings: each one's title, Feature, Preconditions, Repro steps, Observed and Expected. Edit only the Result and each title, Observed and Expected. The rest is there for context.

The reader knows Positron but has not seen the PR, the code or the run. Many read only the Result and the titles.

## Rules

- **The facts are frozen.** Keep every number, quoted UI string, backticked span, file name and value exactly as written. Add no fact, and drop none from Observed or Expected. A clause that only restates the title can go.
- **Keep what is wrong.** A title says what is broken and how. Reword that, never remove it: "both get the same port" cannot become "a port error".
- **Keep the words that narrow it.** "hidden", "renamed", "the first": drop one and the bug sounds wider or vaguer than the run showed.
- Use the words on screen: the button's label, the pane's name, the message's text. Name nothing the reader cannot see (class names, process names, scenario IDs such as S10).
- Name a thing by where the reader sees it, not where it lives. The kernel, the language server, the backend and the extension host are where things live. If the card shows the same thing on screen (a pane, a list, a hover), use that.
- Title: what the user sees go wrong, then when. Lead with the visible problem, not the component or the command. One clause, under about 90 characters, no colon, semicolon, parentheses or `|`.
- One idea per sentence. Subject, verb, object, in the active voice.
- No possessive chains ("the document's kernel's variables") and no noun stacks ("Shiny console session start").
- Don't use one pronoun for two things ("never previews it when it starts").
- Plain words: "shows", "use", "before". No hedging ("seems", "appears to").
- Observed: what happened, in 1-2 sentences, plus at most one for a fact that makes it worse or gets past it. Expected: 1-2 sentences.
- If a field already follows the rules, leave it as it is. Don't rewrite to be different.

## The Result

- It says what the change does for a user, then, in bold, what is broken. At most two sentences and about 50 words.
- Say what works in a phrase ("stats are right for most R and polars column types"). Don't list everything tested; the Tested line below it does that.
- The bold sentence uses the same words as your titles, so the Result and the findings agree. Keep every number, name and value in it, and keep the `**` around it.

## Before -> after

- "Paused columns' tooltip says missing values could not be calculated"
  -> "Tooltip says missing values \"could not be calculated\" while summaries are paused"
- "A column over 10 s to summarize never loads, and Retry cannot help"
  -> "Columns that take over 10 s to summarize never load, even after Retry"
- "Expanded column shows endless loading dots after summaries stop"
  -> "Expanded column keeps loading forever after summaries pause"
- "Deleting a renamed untitled file leaves its editor tab open under the old name"
  -> "Editor tab stays open under the old name after a renamed untitled file is deleted", not "...after a file is deleted"
- "Outline omits functions the language server reports"
  -> "Outline omits functions that Go to Symbol lists"
- Observed: "Of the visible s62 to s79, only s62 has a sparkline. Scrolling up shows s49 to s61 got sparklines: those were off-screen when Continue was pressed."
  -> "Of the visible columns s62 to s79, only s62 has a sparkline. Columns s49 to s61, which were off-screen when Continue was pressed, got sparklines instead."

When a reviewer flags a hard-to-read finding, replace the weakest example here with it. Keep at most six.

## Reply

One line per field you changed, and nothing else. Leave out a field you did not change:

```
RESULT: <new Result, without the **Result:** label>
TITLE: <N>=<new title>
OBSERVED: <N>=<new Observed>
EXPECTED: <N>=<new Expected>
```

`<N>` is the number in the finding's `### Finding N:` heading. If you changed nothing, reply `EDITS: none`.

## Result

{{RESULT}}

## Findings

{{FINDINGS}}
