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
2. Tests: Would each new test fail if the fix were reverted? Does any test compute its expected value with the code under test, or assert the buggy or undesired behavior?
3. Duplication: Is the same logic now in more than one place, or does a helper already exist? Are there sibling code paths (filters, other handlers) with the same bug that a shared helper would fix?
4. State: After an error, retry, refresh, empty result, or leaving the view, can a flag, message, or resource stay stale or leak?
5. Cost: Does the code make a full copy of a column, array, or file only to compute something small? Does it do work on every row or keystroke that scales badly?
6. Platform: Does it assume one OS, or desktop and not web?
7. Judgment calls: Does it choose between two reasonable behaviors, or change something users rely on, or keep an inconsistency between backends? List these under "Needs a human call". Do not decide them.
8. Accuracy: Do comments and the PR description still match the code? Are there leftover or unrelated changes?

## Output

Report only problems. Each finding has:

- The checklist question number.
- The file path and the line number on the PR head.
- A concrete input or case that shows the problem.
- A confidence: high, medium, or low.

Put judgment calls (question 7) in a separate "Needs a human call" list. Do
not decide them.

Never approve and never request changes. Never write `@` before a name.

If the caller gives a JSON schema, return the result only in that schema.
Otherwise, post the findings as inline comments in one pending review, with
the judgment calls in the review summary, and submit it as a comment.
