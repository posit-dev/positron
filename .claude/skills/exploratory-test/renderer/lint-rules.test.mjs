/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINT_RULES } from './lint-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(here, name), 'utf8');

test('every lint rule is checked somewhere', () => {
	const source = ['lint-wording.mjs', 'lint-ledger.mjs', 'lint-json.mjs'].map(read).join('\n');
	assert.deepEqual(Object.keys(LINT_RULES).filter(id => !source.includes(`'${id}'`)), []);
});

// The register is how a contributor finds the check behind a rule, so a renamed rule must not leave it pointing nowhere.
test('every lint rule RULES.md names exists', () => {
	const cited = [...read('../RULES.md').matchAll(/Lint(?: warning)? \(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/`([^`]+)`/g)].map(x => x[1]));
	assert.ok(cited.length > 0);
	assert.deepEqual(cited.filter(id => !(id in LINT_RULES)), []);
});
