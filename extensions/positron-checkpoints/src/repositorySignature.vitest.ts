/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { repositorySignature, SignatureState } from './repositorySignature';

const change = (path: string, status: number) => ({ uri: { toString: () => `file://${path}` }, status });

function state(overrides: Partial<SignatureState> = {}): SignatureState {
	return {
		HEAD: { name: 'main', commit: 'c1', ahead: 0, behind: 0, upstream: { remote: 'origin', name: 'main', commit: 'c1' } },
		mergeChanges: [], indexChanges: [], workingTreeChanges: [change('/p/a.R', 5)], untrackedChanges: [],
		...overrides,
	};
}

describe('repositorySignature', () => {
	test('two reads of an unchanged repository give the same signature, in any order of the files', () => {
		const first = state({ workingTreeChanges: [change('/p/a.R', 5), change('/p/b.R', 5)] });
		const second = state({ workingTreeChanges: [change('/p/b.R', 5), change('/p/a.R', 5)] });

		expect(repositorySignature(first)).toBe(repositorySignature(second));
	});

	test.each([
		['a new commit', state({ HEAD: { name: 'main', commit: 'c2', ahead: 1, behind: 0, upstream: { remote: 'origin', name: 'main', commit: 'c1' } } })],
		['new versions in the shared copy', state({ HEAD: { name: 'main', commit: 'c1', ahead: 0, behind: 1, upstream: { remote: 'origin', name: 'main', commit: 'c2' } } })],
		['another branch', state({ HEAD: { name: 'proposal/x', commit: 'c1' } })],
		['one more changed file', state({ workingTreeChanges: [change('/p/a.R', 5), change('/p/b.R', 5)] })],
		['another status of a file', state({ workingTreeChanges: [change('/p/a.R', 6)] })],
		['a file that moved to the index', state({ workingTreeChanges: [], indexChanges: [change('/p/a.R', 5)] })],
		['a new untracked file', state({ untrackedChanges: [change('/p/n.md', 7)] })],
	])('%s changes the signature', (_name, changed) => {
		expect(repositorySignature(changed)).not.toBe(repositorySignature(state()));
	});
});
