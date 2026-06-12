/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base } from '../_test.setup';

// The Positron notebook editor is the default for .ipynb files; this scoped
// extension exists so the suite-wide afterEach below does not leak to other suites.
export const test = base.extend({});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});
