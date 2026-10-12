/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// A renamed file drops out of the version check without a word.
test('every file versioned-files.txt lists exists', () => {
	const listed = readFileSync(join(root, '.claude/skills/exploratory-test/versioned-files.txt'), 'utf8')
		.split('\n').filter(l => l.trim() && !l.startsWith('#'));
	assert.ok(listed.length > 0);
	assert.deepEqual(listed.filter(p => !existsSync(join(root, p))), []);
});
