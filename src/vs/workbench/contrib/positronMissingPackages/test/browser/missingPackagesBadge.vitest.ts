/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { chooseMissingPackagesTier, installingMessage, installPackagesLabel, missingPackagesBadgeTiers, missingPackagesLabel } from '../../browser/missingPackagesBadge.js';
import { IMissingPackagesResult } from '../../common/missingPackagesService.js';

function makeResult(packages: string[]): IMissingPackagesResult {
	return {
		resource: URI.file('/foo.py'),
		groups: [{ sessionId: 'py', languageId: 'python', packages: packages.map(name => ({ name })) }],
		total: packages.length,
	};
}

describe('missing packages labels', () => {
	it('pluralizes the badge label and names the package on a single-package install', () => {
		expect({
			badgeOne: missingPackagesLabel(1),
			badgeMany: missingPackagesLabel(2),
			installOne: installPackagesLabel(makeResult(['polars'])),
			installMany: installPackagesLabel(makeResult(['pandas', 'plotnine'])),
			installingOne: installingMessage(makeResult(['polars'])),
			installingMany: installingMessage(makeResult(['pandas', 'plotnine'])),
		}).toMatchInlineSnapshot(`
			{
			  "badgeMany": "2 missing packages",
			  "badgeOne": "1 missing package",
			  "installMany": "Install 2 packages",
			  "installOne": "Install 'polars'",
			  "installingMany": "Installing missing packages: 'pandas', 'plotnine'",
			  "installingOne": "Installing missing package 'polars'",
			}
		`);
	});
});

describe('responsive badge tiers', () => {
	it('builds the ordered label tiers, widest first, pluralized', () => {
		expect({
			many: missingPackagesBadgeTiers(5),
			one: missingPackagesBadgeTiers(1),
		}).toMatchInlineSnapshot(`
			{
			  "many": [
			    "5 missing packages",
			    "5 packages",
			    "5",
			    "",
			  ],
			  "one": [
			    "1 missing package",
			    "1 package",
			    "1",
			    "",
			  ],
			}
		`);
	});

	it('chooses the widest tier that fits, and hides when even the icon does not fit', () => {
		// Chrome (icon, arrow, padding) is 40px; tier text widths are 100/50/10/0.
		const chrome = 40;
		const tierTextWidths = [100, 50, 10, 0];
		expect({
			roomyShowsWidest: chooseMissingPackagesTier(200, chrome, tierTextWidths),
			mediumDropsMissing: chooseMissingPackagesTier(95, chrome, tierTextWidths),
			tightShowsCount: chooseMissingPackagesTier(55, chrome, tierTextWidths),
			iconOnly: chooseMissingPackagesTier(45, chrome, tierTextWidths),
			noRoomHides: chooseMissingPackagesTier(30, chrome, tierTextWidths),
		}).toMatchInlineSnapshot(`
			{
			  "iconOnly": 3,
			  "mediumDropsMissing": 1,
			  "noRoomHides": -1,
			  "roomyShowsWidest": 0,
			  "tightShowsCount": 2,
			}
		`);
	});
});
