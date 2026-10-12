/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Saved-output checks for tests. Each scene runs one case and is named for
// what should happen in it; fixtures/<file> holds what each one gave. After a
// change you meant, rewrite the file and review its diff:
//   UPDATE_PAGES=1 node --test <test file>

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A scene's output as text: a string as it is, a list one item per line, a map one entry per input. */
function format(value) {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.length ? value.map(format).join('\n') : '(none)';
	}
	return Object.entries(value).map(([input, out]) => `${input}\n${format(out).replace(/^/gm, '  -> ')}`).join('\n');
}

/** Checks each scene's output against fixtures/`file`, scene by scene; `trim` drops what is pinned elsewhere. */
export function checkScenes(file, scenes, { trim = out => out } = {}) {
	const path = fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));
	const text = Object.entries(scenes).map(([name, scene]) => `==== ${name}\n${trim(format(scene()))}\n`).join('\n');
	if (process.env.UPDATE_PAGES || !existsSync(path)) {
		writeFileSync(path, text);
	}
	const parse = s => new Map(s.split(/^==== /m).slice(1).map(part => [part.slice(0, part.indexOf('\n')), part.slice(part.indexOf('\n') + 1)]));
	const want = parse(readFileSync(path, 'utf8'));
	const got = parse(text);
	assert.deepEqual([...got.keys()], [...want.keys()], `scenes were added, removed or renamed; rewrite fixtures/${file} with UPDATE_PAGES=1`);
	for (const [name, out] of got) {
		const a = out.split('\n');
		const b = want.get(name).split('\n');
		const at = a.findIndex((line, i) => line !== b[i]);
		assert.ok(at === -1 && a.length === b.length, `"${name}" changed at line ${at + 1}: ${a[at]}\nIf meant, rewrite fixtures/${file} with UPDATE_PAGES=1 and review the diff`);
	}
}
