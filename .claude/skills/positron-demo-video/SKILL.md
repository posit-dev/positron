---
name: positron-demo-video
disable-model-invocation: true
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
- ffmpeg installed (`brew install ffmpeg`) -- required, not optional

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

**Propose only steps the script needs.** Every step is a way the recording can fail, and each
re-record costs a minute or two of app startup. Steps that open a panel to show supporting
evidence are the usual culprit -- an on-disk log assertion plus a caption gets the same point
across without driving any UI. If you do include one, say up front that it is the risky part, and
cut it rather than re-recording around it.

### Phase 3: Iterate on Script

Revise the script based on feedback. Keep presenting the updated script until the user approves. Only then move to implementation.

### Phase 4: Record

Once the script is approved:

1. **Write the demo test** -- translate the script into a Playwright test at `test/e2e/demos/<name>.demo.test.ts`.
   This file is scratch, not a test to maintain: it exists to produce one video and is gitignored,
   so never offer to commit it and delete it once the user has the MP4.
   - Pass `extraSettings: { ...DEMO_SCREENCAST_SETTINGS }` in `test.use`. Do **not** override the
     `beforeApp` fixture -- that replaces the one writing the feature flags your demo needs.
   - Use `setupDemoLayout(app, page, { keepSidebar: true })` when the feature lives in the sidebar.
   - Use `narrate()` / `showOverlay()` for captions and `pause()` for pacing.
   - Use `humanClick()` / `humanDoubleClick()` for any click the viewer should see. Screencast
     mode draws no indicator for synthesized mouse events; these draw their own.
   - Wrap polish-only steps in `bestEffort()` so they cannot discard the recording.
   - See `references/demo-patterns.md` for code patterns and the failure modes behind each rule.
2. **Record and post-process in one step:**
   ```bash
   npm run demo:record
   ```
   Naming the demo (`npm run demo:record -- <name>`) is only needed when `test/e2e/demos/` holds
   more than one.
   This records with `DEMO_RECORD_VIDEO=1`, trims the startup, crops the letterbox, converts to
   MP4, and prints the path, duration, size, and a caption timeline. Add `--keep-webm` to keep the
   raw capture.

   The trim points are not guessed: `startDemo()` (called automatically by the first caption)
   holds a black sentinel frame that ffmpeg locates, and the caption manifest gives the end time.
   Reach for `npm run demo:postprocess` alone only to re-cut an existing capture.

**MP4 is required, not preferred.** GitHub rejects `.webm` uploads as attachments. Size limits are
10 MB on free accounts, 100 MB on paid.

### Phase 5: Verify and Deliver

The caption timeline printed by `demo:record` already tells you what is where, so verification is
about judgment, not timestamps: does the pacing read, does any caption lead its action, is the
payoff legible.

**Delegate that to a subagent** to keep large image data out of the main context window:

> Verify the demo video at `demo-videos/<name>.mp4`.
> Extract frames at the caption timestamps below and read them. For each caption, confirm the
> thing it describes is already visible -- flag any caption that appears before its action.
> Also check: click rings visible at each click, no blank or glitched frames, no caption
> colliding with UI, and the payoff text legible at the zoom.
> Report duration, file size, and a one-line description per section.
>
> Caption timeline: <paste from demo:record>
>
> ```bash
> ffprobe -v error -show_entries format=duration,size -of csv=p=0 demo-videos/<name>.mp4
> ffmpeg -y -ss <t> -i demo-videos/<name>.mp4 -frames:v 1 /tmp/frame_<t>.jpg
> ```

Once the subagent reports back, relay the results to the user:
- The video file path (for drag-and-drop into a PR or issue)
- Duration and file size
- A brief summary of what each section shows
- Any issues the subagent flagged

**Attaching it is manual.** `gh` cannot upload attachments; the user has to drag the file into the
PR or issue in a browser. Say so rather than implying the attachment is done.

Ask the user to watch the video and let you know if they want changes.

### Phase 6: Iterate

If the user wants changes, go back to the appropriate phase:
- **Script changes** (different steps, reordering) -> Phase 2
- **Pacing/overlay tweaks** (timing, wording) -> Phase 4
- **Approved** -> delete the `.demo.test.ts` and hand over the video path

## Technical Reference

Demo test files live in `test/e2e/demos/` and are gitignored scratch; only the helpers and scripts
there are checked in. See `demo-utils.ts` for the available helpers (overlay text, human-speed
typing and clicking, zoom, pacing) and `references/demo-patterns.md` for a template to start from
and the failure mode behind each rule.

### Video Output

- Captures at 1920x1080; the app window is smaller, so the capture is cropped in post
- GitHub free: 10MB limit / paid: 100MB limit
- Initialization runs ~40s and is always trimmed (the sentinel marks where it ends)
- MP4 only -- GitHub rejects `.webm` attachments
