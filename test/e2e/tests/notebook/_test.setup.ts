/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, TestFixtures, WorkerFixtures } from '../_test.setup';

// This suite exercises the legacy (VS Code) notebook editor, which is no longer
// the default. The `useLegacyNotebookEditor` option (defined in the base setup)
// disables the Positron notebook editor before the app starts.
export const test = base.extend<TestFixtures, WorkerFixtures>({
	useLegacyNotebookEditor: [true, { scope: 'worker' }],
});
