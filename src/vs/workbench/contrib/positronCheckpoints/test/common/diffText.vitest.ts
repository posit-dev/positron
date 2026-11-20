/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IChangedFile, IHunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { renderChangesForModel } from '../../common/agent/diffText.js';

function hunk(id: string, lines: number): IHunk {
	const header = `@@ -1,0 +1,${lines} @@`;
	return { id, header, addedLines: lines, removedLines: 0, patch: `${header}\n${'+a\n'.repeat(lines)}` };
}

function textFile(path: string, hunks: IHunk[], overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 400, tooLarge: false, hunks, ...overrides };
}

describe('renderChangesForModel', () => {
	test('a text file shows its parts in full and its status in plain words', () => {
		const text = renderChangesForModel({
			basis: 'b1',
			files: [
				textFile('plot.R', [hunk('h1', 1)], { status: 'renamed', oldPath: 'plot_dose.R' }),
				textFile('old.R', [], { status: 'deleted' }),
			],
		}, 1000);

		expect(text).toBe('File: plot.R (renamed from plot_dose.R)\n@@ -1,0 +1,1 @@\n+a\nFile: old.R (removed)');
	});

	test('files are shortened largest first, and only as far as needed', () => {
		const files = [textFile('small.R', [hunk('s', 2)]), textFile('large.R', [hunk('l', 40)]), textFile('medium.R', [hunk('m', 20)])];
		const full = renderChangesForModel({ basis: 'b1', files }, 100000);

		const text = renderChangesForModel({ basis: 'b1', files }, full.length - 1);

		expect(text).toBe([
			'File: small.R (changed)\n@@ -1,0 +1,2 @@\n+a\n+a',
			'File: large.R (changed, contents shortened)\n@@ -1,0 +1,40 @@ (+40 -0 lines)',
			`File: medium.R (changed)\n@@ -1,0 +1,20 @@\n${'+a\n'.repeat(20).trimEnd()}`,
		].join('\n'));
	});

	test('when the parts do not fit, files are reduced to one line each', () => {
		const files = [textFile('a.R', [hunk('a1', 10), hunk('a2', 10), hunk('a3', 10)]), textFile('b.R', [hunk('b1', 10)])];

		const text = renderChangesForModel({ basis: 'b1', files }, 150);

		// The first line of a small part with its counts is longer than the part, so b.R stays whole.
		expect(text).toBe([
			'File: a.R (changed, 3 parts, +30 -0 lines, contents not shown)',
			`File: b.R (changed)\n@@ -1,0 +1,10 @@\n${'+a\n'.repeat(10).trimEnd()}`,
		].join('\n'));
	});

	test('when even the names do not fit, the last files are counted instead', () => {
		const files = Array.from({ length: 2000 }, (_, index) => textFile(`file${index}.R`, [hunk(`h${index}`, 1)]));

		const text = renderChangesForModel({ basis: 'b1', files }, 5000);

		expect(text.length).toBeLessThanOrEqual(5000);
		expect(text).toMatch(/^File: file0\.R /);
		expect(text).toMatch(/\n\(\d+ more files are not shown\)$/);
	});
});
