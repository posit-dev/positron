/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { renderCard, writeCard } from './og-card.mjs';

// The design's own renders, so a template or renderer change that moves a pixel shows up.
const SAMPLES = {
	'1-major-2-minor': { major: 1, minor: 2 },
	'1-moderate': { moderate: 1 },
	'12-major': { major: 12 },
	'2-major-4-moderate-7-minor': { major: 2, moderate: 4, minor: 7 },
	'3-moderate-3-minor': { moderate: 3, minor: 3 },
	'no-findings': {},
};

for (const [name, counts] of Object.entries(SAMPLES)) {
	test(`renderCard draws ${name} as the design does`, async () => {
		const actual = PNG.sync.read(await renderCard(counts));
		const expected = PNG.sync.read(readFileSync(new URL(`./fixtures/og-card/${name}.png`, import.meta.url)));
		assert.deepEqual([actual.width, actual.height], [expected.width, expected.height]);
		assert.ok(actual.data.equals(expected.data), `${name} differs from fixtures/og-card/${name}.png`);
	});
}

test('writeCard reports a failed write, so the page leaves the image out', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'og-card-'));
	try {
		assert.equal(await writeCard(join(dir, 'og.png'), { minor: 1 }), true);
		assert.ok(existsSync(join(dir, 'og.png')));
		assert.equal(await writeCard(join(dir, 'missing', 'og.png'), { minor: 1 }), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
