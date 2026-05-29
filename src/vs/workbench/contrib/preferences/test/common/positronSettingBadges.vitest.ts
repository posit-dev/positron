/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { POSITRON_SETTING_BADGES, getActiveBadges } from '../../common/positronSettingBadges.js';

describe('positronSettingBadges', () => {
	it('registers the legacy and native badges with labels', () => {
		expect(POSITRON_SETTING_BADGES.map(b => b.tag)).toEqual(['legacy', 'native']);
		for (const badge of POSITRON_SETTING_BADGES) {
			expect(badge.label).toBeTruthy();
			expect(badge.description).toBeTruthy();
		}
	});

	it('returns no badges for undefined or empty tag sets', () => {
		expect(getActiveBadges(undefined)).toEqual([]);
		expect(getActiveBadges(new Set())).toEqual([]);
	});

	it('returns only the badges whose tag is present, ignoring unknown tags', () => {
		const active = getActiveBadges(new Set(['native', 'experimental']));
		expect(active.map(b => b.tag)).toEqual(['native']);
	});

	it('returns multiple badges when the setting carries multiple badge tags', () => {
		const active = getActiveBadges(new Set(['legacy', 'native']));
		expect(active.map(b => b.tag)).toEqual(['legacy', 'native']);
	});
});
