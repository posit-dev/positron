# Infrastructure Setup (One-Time)

These steps need to be done once before the first demo can be recorded.

## 1. Create demo-videos directory and gitignore

Add `demo-videos/` to the root `.gitignore`:

```
demo-videos/
```

Create the output directory:
```bash
mkdir -p demo-videos
```

## 2. Create demo utilities

Create `test/e2e/demos/demo-utils.ts` with human-pacing helpers.
See the pre-created file if it exists, otherwise create it with these functions:

- `pause(page, ms)` - Wait between actions for viewer comprehension
- `humanType(page, locator, text, delay?)` - Type with per-character delay
- `humanClick(page, locator)` - Click with natural pauses before/after

## 3. Add recordVideo support to Electron launch

Playwright's `video` config option does NOT automatically apply to Electron contexts.
Video recording for Electron must be configured via `recordVideo` in the `_electron.launch()` call.

### Changes needed:

**`test/e2e/infra/code.ts`** (or wherever `LaunchOptions` is defined):
Add `recordVideo` to the options interface:

```typescript
export interface LaunchOptions {
	// ... existing fields ...
	recordVideo?: { dir: string; size?: { width: number; height: number } };
}
```

**`test/e2e/infra/playwrightElectron.ts`**:
Pass `recordVideo` through to the electron launch call:

```typescript
const electron = await playwright._electron.launch({
	executablePath: configuration.electronPath,
	args: configuration.args,
	env: configuration.env as { [key: string]: string },
	timeout: 0,
	recordVideo: options.recordVideo,
});
```

**`test/e2e/fixtures/test-setup/options.fixtures.ts`** (or equivalent):
When `DEMO_RECORD_VIDEO` env var is set, add recordVideo to the options:

```typescript
if (process.env.DEMO_RECORD_VIDEO) {
	options.recordVideo = {
		dir: path.resolve('demo-videos'),
		size: { width: 1280, height: 720 },
	};
}
```

### Why this approach?

- Backwards compatible: `recordVideo` is optional, existing tests unaffected
- Environment-variable-driven: no config changes needed per demo
- Uses Playwright's native video recording (WebM/VP8, 25fps)
- Video files are automatically finalized when the app/context closes

## 4. Verify setup

Run a minimal demo to verify everything works:

```bash
DEMO_RECORD_VIDEO=1 npx playwright test test/e2e/demos/smoke.demo.ts \
  --project e2e-electron --reporter list --timeout 300000
```

Check that `demo-videos/` contains a `.webm` file after the run.
