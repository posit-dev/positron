---
name: agent-pr-review
description: Use when reviewing a bug-fix PR written by an agent (usually opened by positron-projects[bot]) against the checklist of problems human reviewers most often catch. Read-only review that reports problems and never approves.
---

# Agent PR review

Review one bug-fix PR that an agent wrote. The agent that wrote the fix did
not review it. You are the second reader. Report problems a human reviewer
would otherwise find by hand.

## Inputs

Read these, and nothing else from the PR thread:

1. The diff: `gh pr diff <PR>`.
2. The PR description: `gh pr view <PR> --json title,body`.
3. The body of each issue the PR says it fixes: `gh issue view <N> --json title,body`.

Do not read other review comments or PR comments. The review must not repeat
or lean on what others already said.

## How to work

1. Read the code around each change, not only the diff lines. Open the whole
   function and its callers.
2. Search for sibling code paths that do the same thing (`git grep`). A bug
   fixed in one backend or handler is often still in another.
3. If a suspicion is cheap to test, test it with a short Python or Node
   snippet, and say in the finding that you ran it. Do not build Positron.
4. Ask each question below. Skip a question silently when it does not apply.

## The checklist

1. Coverage: Does the fix cover every case in the issue, including unusual input (empty, null, array-like, dates, special characters, custom formatting) and every backend or code path that has the same bug?
2. Tests: Would each new test fail if the fix were reverted? Does any test compute its expected value with the code under test, or assert the buggy or undesired behavior? The fixing agent must run each new test and see it fail, commit it before the fix, and list the run in the PR body. Check the commits with `gh pr view <PR> --json commits`. Report it if the PR body shows no failing run, or if the test is in the same commit as the fix.
3. Duplication: Is the same logic now in more than one place, or does a helper already exist? Are there sibling code paths (filters, other handlers) with the same bug that a shared helper would fix?
4. State: After an error, retry, refresh, empty result, or leaving the view, can a flag, message, or resource stay stale or leak?
5. Cost: Does the code make a full copy of a column, array, or file only to compute something small? Does it do work on every row or keystroke that scales badly?
6. Platform: Does it assume one OS, or desktop and not web?
7. Judgment calls: Does it choose between two reasonable behaviors, or change something users rely on, or keep an inconsistency between backends? List these under "Needs a human call". Do not decide them.
8. Accuracy: Do comments and the PR description still match the code? Are there leftover or unrelated changes?

## Output

A developer reads this between other work. Every line you post costs their
attention, and a review that cries wolf gets ignored. Report less, not more.

- Report a problem only if you would block the merge over it or a reviewer
  would want to know before approving. No style nits, naming, or anything
  CI already checks (lint, types, failing tests).
- A PR description or code comment that says something the code does not
  do is a problem. Report it.
- Report at most 3 problems and 3 judgment calls. Keep the most important.
- List a real judgment call even when there are no problems.
- Report each problem once, under the question that fits it best.
- Nothing to report is a good result. Return empty lists.

Each problem has:

- A title of at most 6 plain words that names the problem, for example
  "Same bug in a sibling path" or "Test passes without the fix".
- The file path and the line number on the PR head.
- A body of at most 60 words with a concrete input or case that shows it.
  Say if you ran it.
- A confidence: high, medium, or low. Low-confidence findings are not
  posted, so report one only if you are not sure it is real.

Put judgment calls (question 7) in a separate list, each with a short title
and one or two sentences. Do not decide them.

Never approve and never request changes. Never write `@` before a name.

If the caller gives a JSON schema, return the result only in that schema.
Otherwise, post one review as a comment: a count line, the problems, then
the judgment calls. If both lists are empty, say only "No problems found"
and name what you checked.
