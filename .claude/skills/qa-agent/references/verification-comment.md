# Verification Comment

When the user asks for a verification comment (to post on an issue or PR), generate
it using this GitHub Markdown format. Run `detect_versions.sh` if you haven't already.

## Format

```markdown
### Verified Fixed
Positron Version(s): <version> (build <build>)
OS Version(s): <os>

### Test scenario(s)

**Primary verification:**
- <Main scenario that directly tests the fix/feature>
- <Another key scenario>

**Edge cases:**
- <Edge case 1>
- <Edge case 2>

**Regression checks:**
- <Related area that should still work>

### Rough edges
- <Any UX concerns, surprising behaviors, or minor issues noticed during testing>
- <Even on passing tests -- note anything that felt off>

### Link(s) to test cases run or created:

<details>
<summary><code><file path, e.g. test/e2e/tests/_generated/0405_9638-notebook-outline.test.ts></code></summary>

\`\`\`typescript
<paste the full contents of the saved .test.ts file here>
\`\`\`

</details>
```

If no test file was saved, replace the collapsible section with `n/a`.

## Rules

- Use plain bullet points, not checkboxes or tables
- Omit sections that have no content (e.g., skip "Edge cases" if there were none)
- Keep scenario descriptions concise -- one line each, describe what was tested not how
- "Rough edges" replaces "Notes" -- focus on UX observations, not internal metrics
- Never include retry counts, step durations, or tool call counts -- those are internal
- Always include the "Rough edges" section even if empty ("None observed")
- **Write to a temp file and copy to clipboard.** Do NOT output as a markdown chat
  response -- it renders the HTML and makes it impossible to copy. Instead:
  ```bash
  # Write to temp file (reliable fallback)
  cat << 'EOF' > /tmp/verification-comment.md
  <comment content>
  EOF
  # Copy to clipboard (platform-aware, best-effort)
  cat /tmp/verification-comment.md | pbcopy 2>/dev/null || cat /tmp/verification-comment.md | clip 2>/dev/null || cat /tmp/verification-comment.md | xclip -selection clipboard 2>/dev/null || true
  echo "Verification comment copied to clipboard and saved to /tmp/verification-comment.md"
  ```
