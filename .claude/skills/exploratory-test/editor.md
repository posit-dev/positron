An automated test run found the bugs below and wrote each up as a record of the run: harness steps, PASS checks, waits, scenario IDs, and reasoning about what it saw. A developer triaging the filed issue has to translate that back into a bug before they can act on it.

For each finding, write the part a person reads first, and its title. The run's record stays below it, folded, so leave out anything that is only there as evidence. Each finding is filed as its own issue, so each must stand alone. Then rewrite the report's Result line.

The reader knows Positron but has not seen the PR, the code or the run.

## Each finding

**Summary**: one or two sentences, said the way you would tell a colleague at their desk: "When you do X, Y happens instead of Z." Add the one consequence a user hits next only if it is worse than the bug itself. Leave out side observations, comparisons and counts; they stay in the record. Don't start with the feature's name ("In the Data Explorer, ..."); the title carries it. Plain words; no reasoning about why.

**Steps**: the fewest steps a person would do by hand to see it, 3 to 5. Each is an action. Mark the step where it goes wrong with what they see, e.g. "Nothing opens." Copy anything the user types or runs (code, names, commands) word for word from the record, in the same backticks or code block; do not describe it. Leave out:
- steps that only confirm something worked
- waits, sampling, timings that were only how the harness watched
- scenario and step IDs (S05, S12-08)
- setup the harness needed that a person does not (proxies, settings it sets in every profile), unless the bug needs it; then say it plainly ("with PyPI unreachable").

**Where**: one line, only if it changes who hits it: the platform, build or setting it needs, and what was not checked. If it needs the web build, say "web (and so Workbench)". Leave out the OS and build when nothing suggests the bug depends on them. Otherwise leave it empty.

**Title**: written last, from your summary. The filed issue is titled `<feature>: <your title>`, with the finding's **Feature:** line as the feature, so don't repeat the feature. The title is the summary's first sentence cut to its core: aim for 12 words or fewer, no code or file names, no colon, semicolon or `|`. Keep what makes it a bug: a condition that narrows it ("of 1,000 or more", "until you Tab") or that it persists ("stays that way after reconnecting"). If those take more than 12 words, keep them; a longer true title beats a short one that says less. Start it with a capital unless its first word is a name written in lowercase, such as polars.

Keep every fact you use true to the record; do not add one it does not have, and keep numbers, quoted UI text and code exactly as the record writes them. Do not use a name a user would not see on screen: no component, class, function or file names, and no "kernel", "language server", "extension host" or "backend" unless the user would see that word. Name a thing by where the reader sees it: the button's label, the pane's name, the message's text.

## Before -> after

Summary, from a record whose opening said only "Duplicated control in the notebook toolbar":
"When you open a Python notebook, its toolbar shows the "2 missing packages" badge twice, one on each side of the restart button, instead of once."

Summary, from "Click appears dead; a follow-up Escape cancels the whole flow":
"The first click on Browse... on the "Folder Name and Location" step does nothing: no folder picker appears. If you press Escape after that dead click, the whole flow is cancelled."

Titles:
- "first `Browse...` click in the flow shows no folder picker" -> "First Browse... click opens no folder picker"
- "An offline check says all packages are installed, and it sticks after reconnecting" -> "Offline check says all installed, and stays that way after reconnecting"
- "Enter does nothing until you Tab to a button" -> "Enter does nothing on New Folder Created dialog until you Tab"

## The Result

Rewrite the Result line too.

- It says what the change does for a user, then, in bold, what is broken. At most two sentences and about 50 words.
- Say what works in a phrase ("stats are right for most R and polars column types"). Don't list everything tested; the Tested line below it does that.
- The bold sentence uses the same words as your titles, so the Result and the findings agree. Keep every number, name and value in it, and keep the `**` around it.
- If it already follows these rules, leave it out of your reply.

## Reply

Reply with only this. The RESULT line first, if you changed it, then a block for every finding, in order:

```
RESULT: <new Result, without the **Result:** label>

=== Finding <N>
TITLE: <title>
SUMMARY: <summary>
STEPS:
1. <step>
2. <step>
WHERE: <where line, or nothing>
```

`<N>` is the number in the finding's `### Finding N:` heading. A code block under a step is indented three spaces.

## Result

{{RESULT}}

## Findings

{{FINDINGS}}
