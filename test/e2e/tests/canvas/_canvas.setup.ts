/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fixtures for Positron-hosted Canvas specs. Each test gets its own
// CanvasHarness: a fresh profile, fixture folders, and the assistant under
// test, launched and relaunched by the test itself. The shared `app` fixture
// in ../_test.setup.ts is deliberately not used: it launches one app per
// worker on the shared test-files workspace, while these tests start in temp
// folders and quit, kill, and relaunch the app repeatedly.

import * as fs from 'fs';
import * as path from 'path';
import { test as base, expect, TestInfo } from '@playwright/test';
import { AssistantSource, CanvasHarness, CanvasHarnessOptions } from '../../infra/canvasHarness';
import { TestTags } from '../../infra/test-runner/test-tags';

export { expect };
export const tags = TestTags;

/**
 * Which assistant a test needs. `vsix` for anything that depends on a
 * non-development extension host: hot-exit backups and restoring the last
 * session's windows only happen without --extensionDevelopmentPath.
 */
export type AssistantMode = 'dev' | 'vsix' | 'any';

/**
 * The assistant under test, from the environment:
 * - CANVAS_ASSISTANT_PATH: an assistant `packages/positron` dir with `dist/` built (dev mode)
 * - CANVAS_ASSISTANT_VSIX: a packaged assistant VSIX (vsix mode)
 * - CANVAS_ASSISTANT=dev|vsix: which one `any` prefers when both are set (default dev)
 */
export function assistantFromEnv(mode: AssistantMode): AssistantSource | undefined {
	const dev = process.env.CANVAS_ASSISTANT_PATH;
	const vsix = process.env.CANVAS_ASSISTANT_VSIX;
	const devSource = dev && fs.existsSync(path.join(dev, 'dist', 'extension.js')) ? { kind: 'dev', path: dev } as const : undefined;
	const vsixSource = vsix && fs.existsSync(vsix) ? { kind: 'vsix', path: vsix } as const : undefined;
	if (mode === 'dev') {
		return devSource;
	}
	if (mode === 'vsix') {
		return vsixSource;
	}
	return process.env.CANVAS_ASSISTANT === 'vsix' ? vsixSource ?? devSource : devSource ?? vsixSource;
}

interface CanvasFixtures {
	/** Which assistant the test needs; the test is skipped when it is not configured. */
	assistantMode: AssistantMode;
	/** Harness options for the test (trust, folders, aliases, settings...). */
	harnessOptions: Partial<CanvasHarnessOptions>;
	/** The test's Canvas harness; nothing is launched yet. */
	harness: CanvasHarness;
	/** Runs `body` as a report step, then screenshots every on-screen window. */
	step: <T>(title: string, body: () => Promise<T>) => Promise<T>;
}

export const test = base.extend<CanvasFixtures>({
	assistantMode: ['any', { option: true }],
	harnessOptions: [{}, { option: true }],

	harness: async ({ assistantMode, harnessOptions }, use, testInfo) => {
		const assistant = assistantFromEnv(assistantMode);
		testInfo.skip(!assistant, assistantMode === 'vsix'
			? 'Set CANVAS_ASSISTANT_VSIX to a Canvas-capable Posit Assistant VSIX'
			: 'Set CANVAS_ASSISTANT_PATH (assistant packages/positron, dist built) or CANVAS_ASSISTANT_VSIX');

		const harness = await CanvasHarness.create({ assistant: assistant!, artifactsDir: testInfo.outputPath('canvas'), ...harnessOptions });
		testInfo.annotations.push({ type: 'canvas assistant', description: `${assistant!.kind}: ${assistant!.path}` });
		try {
			await use(harness);
		} finally {
			await harness.dispose();
			await attachArtifacts(testInfo, testInfo.outputPath('canvas'));
			if (testInfo.status === testInfo.expectedStatus && !process.env.CANVAS_KEEP_PROFILE) {
				harness.removeProfile();
			} else {
				testInfo.annotations.push({ type: 'canvas profile (kept)', description: harness.root });
			}
		}
	},

	step: async ({ harness }, use) => {
		await use(async (title, body) => test.step(title, async () => {
			try {
				return await body();
			} finally {
				if (harness.running) {
					await harness.shot(title).catch(() => undefined);
				}
			}
		}));
	},
});

/** Attaches screenshots, videos, traces, and timelines so the run can be reviewed afterwards. */
async function attachArtifacts(testInfo: TestInfo, dir: string): Promise<void> {
	const walk = (d: string): string[] => fs.existsSync(d)
		? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
		: [];
	for (const file of walk(dir)) {
		const rel = path.relative(dir, file);
		if (/\.(png|webm|zip)$/.test(file) || /window-timeline\.txt$|harness\.log$/.test(file)) {
			await testInfo.attach(rel, { path: file });
		}
	}
}
