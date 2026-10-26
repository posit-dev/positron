/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// run.mjs and gate.mjs run on import, so no test imports them; a name the
// renderer stopped exporting would fail only in CI, after the build.
test('every name the action imports from a local module is exported there', async () => {
	const missing = [];
	for (const file of readdirSync(here).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
		const source = readFileSync(join(here, file), 'utf8');
		// An import list split over lines is read as one.
		const flat = source.replace(/^import \{([^}]+)\}/gm, (_, names) => `import {${names.replace(/\s+/g, ' ')}}`);
		for (const m of flat.matchAll(/^import \{([^}]+)\} from '(\.{1,2}\/[^']+)';$/gm)) {
			const target = await import(pathToFileURL(resolve(here, m[2])).href);
			for (const name of m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
				if (!(name in target)) {
					missing.push(`${file}: ${name} from ${m[2]}`);
				}
			}
		}
	}
	assert.deepEqual(missing, []);
});
