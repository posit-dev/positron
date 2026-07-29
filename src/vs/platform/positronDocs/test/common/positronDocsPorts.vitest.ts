/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { joinDocsPath } from '../../common/positronDocsPorts.js';

describe('joinDocsPath', () => {
	it.each([
		['joins plain segments', ['/c', '2026.05.0-179', 'llms.txt'], '/c/2026.05.0-179/llms.txt'],
		['preserves a leading slash', ['/c', 'x'], '/c/x'],
		['drops a trailing slash on the root', ['/c/', 'x'], '/c/x'],
		['collapses slashes between segments', ['/c/', '/x/', '/y'], '/c/x/y'],
		['skips empty segments', ['/c', '', 'x'], '/c/x'],
		// An all-slashes segment strips to empty, which used to join into a
		// stray trailing slash and produce a path that reads as a directory.
		['skips an all-slashes segment', ['/c', '///'], '/c'],
		['keeps a single segment unchanged', ['/c'], '/c'],
	])('%s', (_label, segments, expected) => {
		expect(joinDocsPath(...segments)).toBe(expected);
	});
});
