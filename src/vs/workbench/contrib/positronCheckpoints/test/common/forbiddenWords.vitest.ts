/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';

describe('FORBIDDEN_WORDS', () => {
	test('matches the plural and verb forms of every git word, in any letter case', () => {
		const words = [
			'branch', 'branches', 'commit', 'commits', 'committed', 'committing', 'stage', 'staged', 'stages', 'staging',
			'rebase', 'rebased', 'rebases', 'rebasing', 'merge', 'merged', 'merges', 'merging', 'pull', 'pulls', 'pulled', 'pulling',
			'push', 'pushes', 'pushed', 'pushing', 'fetch', 'fetches', 'fetched', 'fetching', 'HEAD',
			'conflict', 'conflicts', 'conflicted', 'conflicting', 'Merged', 'COMMITS', 'Pulled',
		];

		expect(words.filter(word => !FORBIDDEN_WORDS.test(`We ${word} it.`))).toEqual([]);
	});

	test('allows the ordinary word head and words that only contain a git word', () => {
		const allowed = ['head', 'Head of the table', 'headline', 'pushover', 'emerged', 'stagecoach', 'committee', 'refetchable'];

		expect(allowed.filter(text => FORBIDDEN_WORDS.test(text))).toEqual([]);
	});
});
