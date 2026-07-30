/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { getAgentSkillRoots } from '../../../common/positron/positronSkillRoots.js';

describe('getAgentSkillRoots', () => {
	it('returns the skills directory under a file-scheme appRoot', () => {
		const roots = getAgentSkillRoots(URI.file('/Applications/Positron.app/Contents/Resources/app'));
		expect(roots).toHaveLength(1);
		expect(roots[0].endsWith('skills')).toBe(true);
		expect(roots[0].startsWith('/Applications/Positron.app')).toBe(true);
	});

	it('returns nothing when appRoot is undefined', () => {
		expect(getAgentSkillRoots(undefined)).toEqual([]);
	});

	it('returns nothing for a non-file appRoot, where an fsPath is meaningless', () => {
		expect(getAgentSkillRoots(URI.parse('https://example.com/app'))).toEqual([]);
	});
});
