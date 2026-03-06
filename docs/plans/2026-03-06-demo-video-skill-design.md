# Demo Video Skill Design

## Purpose

A Claude Code skill that generates polished demo videos of Positron features for PR descriptions, using Playwright's built-in video recording against the Electron app.

## Two Modes

**Mode 1: Fresh demo script** -- User describes the feature steps in natural language. Claude writes a Playwright test file in `test/e2e/demos/` with human-speed pacing and video recording enabled.

**Mode 2: Adapt existing test** -- User points to an existing e2e test. Claude copies/adapts it into `test/e2e/demos/` with added delays and video recording.

## File Structure

```
test/e2e/demos/
  demo.setup.ts          # Shared config: video on, extended timeouts
  demo-utils.ts           # Utilities: humanType(), pause(), humanClick()
  <feature-name>.demo.ts  # Individual demo scripts

demo-videos/              # Gitignored output directory
  <feature-name>.webm
  <feature-name>.mp4      # If ffmpeg available
```

## Key Components

### Demo Setup (demo.setup.ts)

Thin wrapper around the existing `_test.setup.ts` that:
- Enables `video: { mode: 'on', size: { width: 1280, height: 720 } }`
- Sets extended timeouts (5 min per test since demos run slowly)
- Configures video output to `demo-videos/`

### Human-Pace Utilities (demo-utils.ts)

Small helpers for readable demo scripts:
- `pause(ms)` -- let the viewer absorb what happened
- `humanType(locator, text)` -- type at ~80ms per keystroke
- `humanClick(locator)` -- click with brief delay before/after

### Demo Script Pattern

```typescript
import { test } from './demo.setup';
import { pause, humanType } from './demo-utils';

test('demo: feature name', async ({ app, page, notebooks }) => {
  await notebooks.openNotebook('example.ipynb');
  await pause(1500);
  // ... demo steps with human pacing ...
});
```

## Execution Flow (what the skill guides Claude through)

1. Determine mode (fresh script vs adapt existing test)
2. Write the demo script with human-pacing delays
3. Run: `npx playwright test test/e2e/demos/<name>.demo.ts --project e2e-electron`
4. Check for ffmpeg and convert to MP4 if available
5. Report output paths and file sizes

## Post-Recording

- If ffmpeg available: `ffmpeg -i demo.webm -c:v libx264 -crf 20 -preset slow demo.mp4`
- Flag if output exceeds 10MB (GitHub free plan limit)
- Print path for drag-and-drop into PR description

## What Gets Committed

- `demo.setup.ts` and `demo-utils.ts` -- shared infrastructure, committed
- Individual `.demo.ts` scripts -- user's choice
- `demo-videos/` -- gitignored, never committed

## Technical Constraints

- Playwright records WebM only (VP8, 25fps, no audio)
- `slowMo` not available for Electron -- human pacing via explicit delays
- GitHub PRs accept WebM directly; MP4 conversion improves Safari compat
- GitHub video size limits: 10MB free / 100MB paid
