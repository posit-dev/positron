/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { POSITRON_SETTING_BADGES, getActiveBadges } from '../../common/positronSettingBadges.js';

describe('positronSettingBadges', () => {
	it('registers the legacy badge with a label', () => {
		expect(POSITRON_SETTING_BADGES.map(b => b.tag)).toContain('legacy');
		for (const badge of POSITRON_SETTING_BADGES) {
			expect(badge.label).toBeTruthy();
			expect(badge.description).toBeTruthy();
		}
	});

	it('returns no badges for undefined or empty tag sets', () => {
		expect(getActiveBadges(undefined)).toEqual([]);
		expect(getActiveBadges(new Set())).toEqual([]);
	});

	it('returns the legacy badge for a legacy-tagged setting, ignoring other tags', () => {
		const active = getActiveBadges(new Set(['legacy', 'experimental']));
		expect(active.map(b => b.tag)).toEqual(['legacy']);
	});

	it('returns no badge for the positronNotebook filter-only tag', () => {
		expect(getActiveBadges(new Set(['positronNotebook']))).toEqual([]);
	});
});
