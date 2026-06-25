/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { installPackagesLabel, missingPackagesLabel } from '../../browser/missingPackagesBadge.js';
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
		}).toMatchInlineSnapshot(`
			{
			  "badgeMany": "2 missing packages",
			  "badgeOne": "1 missing package",
			  "installMany": "Install 2 packages",
			  "installOne": "Install 'polars'",
			}
		`);
	});
});
