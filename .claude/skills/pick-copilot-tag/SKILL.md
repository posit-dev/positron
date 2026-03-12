---
name: pick-copilot-tag
description: Determine which vscode-copilot-chat release tag to use for a Positron build
---

# Pick Copilot Tag

Determine which `microsoft/vscode-copilot-chat` release tag is compatible with
a given Positron build by checking API proposal version compatibility.

## When to Use

Use this skill when:
- Deciding which copilot-chat tag to merge after an upstream Code OSS update
- A release build rejects copilot-chat with "API proposals not compatible"
- Upgrading copilot-chat and need to find the latest compatible tag

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- `python3` available

## Workflow

### Step 1: Run the Check

From the Positron repo root, run the script with no arguments. It will
automatically read `package.json` for the Code OSS version, extract proposals
from the source tree, discover compatible tag series, and check them all:

```bash
.claude/skills/pick-copilot-tag/scripts/check-proposals.sh
```

For checking against a built Positron app instead of the source tree:

```bash
.claude/skills/pick-copilot-tag/scripts/check-proposals.sh /Applications/Positron.app
```

To check a specific tag series (skips auto-discovery):

```bash
.claude/skills/pick-copilot-tag/scripts/check-proposals.sh <proposals-source> <tag-prefix>
```

### Step 2: Report Results

The script outputs each tag as OK or BAD with specific mismatches. Report:
- The **latest compatible tag** (first OK in descending version order)
- What breaks in newer tags (which proposals changed)
- A recommendation

Use `-v` / `--verbose` to show the full proposals list instead of just the count.

## Example Output

```
Positron proposals: 23 versioned (from src/vs/.../extensionsApiProposals.ts)

Code OSS version: 1.109.0
Checking recent tag series for engine compatibility:
  v0.36 -> ^1.108.0 (compatible)
  v0.37 -> ^1.109.0 (compatible)
  v0.38 -> ^1.110.0 (needs Code OSS > 1.109.0)

--- v0.37 ---
BAD v0.37.9
   chatHooks@6 (not in Positron)
   chatParticipantPrivate@13 (Positron has chatParticipantPrivate@12)
BAD v0.37.6
   chatHooks@6 (not in Positron)
   chatParticipantPrivate@13 (Positron has chatParticipantPrivate@12)
OK  v0.37.5
OK  v0.37.4
OK  v0.37.0

--- v0.36 ---
OK  v0.36.4
OK  v0.36.0

Latest compatible: v0.37.5
```
