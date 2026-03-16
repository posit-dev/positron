---
name: positron-demo-video
description: Use when the user wants to create a demo video, record a feature walkthrough, or generate a video for a PR description. Triggers on "record a demo", "make a video", "demo video for PR", or "generate a walkthrough".
---

# Positron Demo Video Generator

Creates polished demo videos of Positron features through a collaborative script-then-record workflow.

## When to Use

- User asks to create a demo video for a PR
- User wants to record a feature walkthrough
- User says "generate a video", "record a demo", "make a video for the PR"

## Prerequisites

- Positron must be built (`npm run build-ps` to check)
- ffmpeg installed for MP4 conversion (optional but recommended)

## Workflow

This is a collaborative process. Do NOT jump straight to writing code.

```
Research -> Propose Script -> Iterate -> Record -> Review -> Iterate
```

### Phase 1: Research

Understand what to demo by examining the current branch:

1. Read recent commits (`git log --oneline main..HEAD`)
2. Look at changed files to understand the feature
3. Check for existing e2e tests that exercise the feature (may provide page object methods)
4. If adapting an existing test, read it fully

### Phase 2: Propose a Script

Present a plain-text "script" to the user -- a numbered list of what the video will show, step by step. Include:

- **What the viewer sees** at each step
- **Overlay text** for each section (the narration captions)
- **Estimated duration** per section

Example format:

```
Demo Script: Notebook Cell Drag to Reorder

1. [2s] Notebook with 5 cells visible, clean layout
   Overlay: "Drag and drop: grab the handle to reorder cells"

2. [3s] Hover over Cell 0 to reveal drag handle, then drag it to position 2
   Overlay: (same, persists)

3. [4s] Select Cell 4, move it up 3 times with Alt+ArrowUp
   Overlay: "Keyboard: Alt+Arrow to move cells up/down"

4. [4s] Multi-select cells 1-3 with Shift+Arrow, drag to end
   Overlay: "Multi-select: Shift+Arrow to select, then drag together"

5. [3s] Undo 3 times to restore original order
   Overlay: "Undo: Ctrl/Cmd+Z restores previous order"

Total: ~16s of action (+ ~12s trimmed initialization)
```

**Ask the user for feedback.** Common adjustments:
- Reorder steps for better narrative flow
- Add/remove steps
- Change overlay wording
- Adjust which features to highlight

### Phase 3: Iterate on Script

Revise the script based on feedback. Keep presenting the updated script until the user approves. Only then move to implementation.

### Phase 4: Record

Once the script is approved:

1. **Write the demo test** -- translate the script into a Playwright test at `test/e2e/demos/<name>.demo.test.ts`
   - Use `setupDemoLayout()` to collapse panels and enable screencast mode
   - Include `...DEMO_SCREENCAST_SETTINGS` in the test's `settingsFile.append()`
   - Use `narrate()` / `showOverlay()` for captions
   - Use `pause()` between actions for pacing
   - See `references/demo-patterns.md` for code patterns
2. **Run it:**
   ```bash
   DEMO_RECORD_VIDEO=1 npx playwright test test/e2e/demos/<name>.demo.test.ts \
     --project e2e-electron --reporter list --timeout 300000
   ```
3. **Trim and convert** -- use a subagent to find the start trim point (where initialization ends) and end trim point (where cleanup begins), then:
   ```bash
   ffmpeg -ss <START_SECONDS> -t <DURATION> -i demo-videos/<hash>.webm \
     -c:v libx264 -crf 20 -preset slow -an demo-videos/<name>.mp4
   ```
   - `-ss`: skip initialization (typically ~10s)
   - `-t`: duration to keep (cut before editor-close cleanup frames)

### Phase 5: Verify and Deliver

After trimming/converting, **delegate verification to a subagent** to avoid polluting the main context window with large image data.

Launch a subagent (using the Agent tool) with a prompt like:

> Verify the demo video at `demo-videos/<name>.mp4`.
> Extract thumbnail frames at key moments and read them to confirm overlays are visible, layout looks correct, and pacing is reasonable.
> Report back: duration, file size, and a brief description of what each section shows.
> Flag any issues (missing overlays, bad cropping, blank frames, etc.).
>
> Commands to use:
> ```bash
> # Get duration and file size
> ffprobe -v error -show_entries format=duration,size -of csv=p=0 demo-videos/<name>.mp4
>
> # Extract frames at key moments
> for t in 1 5 10 15 20; do
>   ffmpeg -y -ss $t -i demo-videos/<name>.mp4 -frames:v 1 /tmp/frame_${t}s.jpg 2>/dev/null
> done
> ```
> Then read each `/tmp/frame_*.jpg` to visually inspect the frames.

Once the subagent reports back, relay the results to the user:
- The video file path (for drag-and-drop into PR)
- Duration and file size
- A brief summary of what each section shows
- Any issues the subagent flagged

Ask the user to watch the video and let you know if they want changes.

### Phase 6: Iterate

If the user wants changes, go back to the appropriate phase:
- **Script changes** (different steps, reordering) -> Phase 2
- **Pacing/overlay tweaks** (timing, wording) -> Phase 4
- **Approved** -> done, user has the video path

## Technical Reference

Demo test files live in `test/e2e/demos/`. See `demo-utils.ts` for available helper functions (overlay text, human-speed typing/clicking, zoom, pacing, etc.) and existing `.demo.test.ts` files for examples. See `references/demo-patterns.md` for common demo patterns.

### Video Output

- Records at 1920x1080 (1080p) for crisp output on retina displays
- GitHub free: 10MB limit / paid: 100MB limit
- First ~10-15s is initialization (always trimmed)
- WebM works on GitHub; MP4 has better Safari compat
