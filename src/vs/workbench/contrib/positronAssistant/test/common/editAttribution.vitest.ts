/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { changeStates, IChange } from '../../common/editAttribution.js';
import { IPositronTrackedEditState } from '../../common/positronEditReview.js';

/** The file as lines `a` to `e`, with the given lines replaced. */
function file(replaced: Record<string, string> = {}): string {
	return ['a', 'b', 'c', 'd', 'e'].map(line => replaced[line] ?? line).join('\n') + '\n';
}

/** Five groups of edits, each changing one line of the file in turn. */
const oneLineEach: IChange[] = ['a', 'b', 'c', 'd', 'e'].map((_line, i, lines) => {
	const changed = (count: number) => Object.fromEntries(lines.slice(0, count).map(old => [old, old.toUpperCase()]));
	return { before: file(changed(i)), after: file(changed(i + 1)) };
});
const allChanged = file({ a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' });

describe('changeStates', () => {
	it.each<[string, string, string, IPositronTrackedEditState[]]>([
		['nothing reviewed yet', file(), allChanged, ['pending', 'pending', 'pending', 'pending', 'pending']],
		['the first two kept', file({ a: 'A', b: 'B' }), allChanged, ['kept', 'kept', 'pending', 'pending', 'pending']],
		['the third undone', file(), file({ a: 'A', b: 'B', d: 'D', e: 'E' }), ['pending', 'pending', 'undone', 'pending', 'pending']],
		['all settled, the third undone', file({ a: 'A', b: 'B', d: 'D', e: 'E' }), file({ a: 'A', b: 'B', d: 'D', e: 'E' }), ['kept', 'kept', 'undone', 'kept', 'kept']],
	])('tells each change apart: %s', (_name, baseline, current, expected) => {
		expect(changeStates(oneLineEach, baseline, current)).toEqual(expected);
	});

	it('is pending while any of a change is, and partial once settled both ways', () => {
		const both = [{ before: file(), after: file({ a: 'A', e: 'E' }) }];

		expect(changeStates(both, file({ a: 'A' }), file({ a: 'A', e: 'E' }))).toEqual(['pending']);
		expect(changeStates(both, file({ a: 'A' }), file({ a: 'A' }))).toEqual(['partial']);
	});

	it.each<[IPositronTrackedEditState, string, string]>([
		['pending', file(), 'a\nb\nd\ne\n'],
		['kept', 'a\nb\nd\ne\n', 'a\nb\nd\ne\n'],
		['undone', file(), file()],
	])('is %s for a deleted line', (expected, baseline, current) => {
		const deletion = [{ before: file(), after: 'a\nb\nd\ne\n' }];

		expect(changeStates(deletion, baseline, current)).toEqual([expected]);
	});

	it('gives a change rewritten by a later one the outcome of the file', () => {
		const rewritten = [
			{ before: file(), after: file({ c: 'C1' }) },
			{ before: file({ c: 'C1' }), after: file({ c: 'C2' }) },
		];

		expect(changeStates(rewritten, file({ c: 'C2' }), file({ c: 'C2' }))).toEqual(['kept', 'kept']);
		expect(changeStates(rewritten, file(), file())).toEqual(['undone', 'undone']);
	});

	it('does not count edits made between the changes as a change', () => {
		const userEdited = [
			{ before: file(), after: file({ a: 'A' }) },
			// The user changed `e` before the second change.
			{ before: file({ a: 'A', e: 'mine' }), after: file({ a: 'A', c: 'C', e: 'mine' }) },
		];

		expect(changeStates(userEdited, file({ a: 'A', e: 'mine' }), file({ a: 'A', c: 'C', e: 'mine' }))).toEqual(['kept', 'pending']);
	});

	it('tracks a created file', () => {
		const created = [{ before: undefined, after: 'x <- 1\n' }];

		expect(changeStates(created, '', 'x <- 1\n')).toEqual(['pending']);
		expect(changeStates(created, 'x <- 1\n', 'x <- 1\n')).toEqual(['kept']);
	});
});
