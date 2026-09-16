/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Record a demo and produce a shippable MP4 in one step.
 *
 *   npm run demo:record                               # the only demo in test/e2e/demos/
 *   npm run demo:record -- my-feature                 # test/e2e/demos/my-feature.demo.test.ts
 *   npm run demo:record -- test/e2e/demos/my-feature.demo.test.ts
 *   npm run demo:record -- my-feature --keep-webm     # keep the raw capture
 *
 * Demo specs are scratch. You write one to get a video and then delete it, so `test/e2e/demos/`
 * normally holds exactly one and naming it is optional.
 *
 * Extra flags are passed through to Playwright, except --keep-webm which belongs to the
 * post-processing step.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEMO_DIR = path.dirname(process.argv[1]);
const ROOT = path.resolve(DEMO_DIR, '../../..');

const args = process.argv.slice(2);
const keepWebm = args.includes('--keep-webm');
const rest = args.filter(a => a !== '--keep-webm');
const target = rest[0] && !rest[0].startsWith('-') ? rest[0] : null;
const passthrough = target ? rest.slice(1) : rest;

const specPath = target ? resolveSpec(target) : soleSpec();
if (!fs.existsSync(path.resolve(ROOT, specPath))) {
	console.error(`No demo spec at ${specPath}`);
	process.exit(1);
}

const name = path.basename(specPath).replace(/\.demo\.test\.ts$/, '');

// Stale captures would make the post-processing step pick the wrong file.
for (const file of fs.existsSync(path.join(ROOT, 'demo-videos')) ? fs.readdirSync(path.join(ROOT, 'demo-videos')) : []) {
	if (file.endsWith('.webm')) {
		fs.rmSync(path.join(ROOT, 'demo-videos', file), { force: true });
	}
}

const playwright = spawnSync('npx', [
	'playwright', 'test', specPath,
	'--project', 'e2e-electron',
	'--reporter', 'list',
	'--timeout', '300000',
	'--workers', '1',
	...passthrough,
], {
	cwd: ROOT,
	stdio: 'inherit',
	env: { ...process.env, DEMO_RECORD_VIDEO: '1' },
});

if (playwright.status !== 0) {
	console.error('\nRecording failed; not post-processing. The raw capture is in demo-videos/.');
	process.exit(playwright.status ?? 1);
}

const post = spawnSync('node', [
	'--experimental-strip-types',
	path.join(DEMO_DIR, 'postprocess-demo-video.ts'),
	'--name', name,
	...(keepWebm ? ['--keep-webm'] : []),
], { cwd: ROOT, stdio: 'inherit' });

process.exit(post.status ?? 0);

/** Accept either a path or a bare demo name. */
function resolveSpec(value: string): string {
	if (value.endsWith('.ts')) {
		return value;
	}
	return path.join('test', 'e2e', 'demos', `${value}.demo.test.ts`);
}

/** The demo to record when none was named. Ambiguity is the user's to resolve, not ours. */
function soleSpec(): string {
	const found = fs.readdirSync(DEMO_DIR).filter(f => f.endsWith('.demo.test.ts'));
	if (found.length === 1) {
		return path.join('test', 'e2e', 'demos', found[0]);
	}
	if (found.length === 0) {
		console.error('No demo spec in test/e2e/demos/. Write a <name>.demo.test.ts first.');
	} else {
		console.error(`Several demos in test/e2e/demos/; name one: ${found.map(f => f.replace(/\.demo\.test\.ts$/, '')).join(', ')}`);
	}
	process.exit(1);
}
