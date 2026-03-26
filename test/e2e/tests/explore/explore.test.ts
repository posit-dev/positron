/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { startServer } from './server';

const TEN_MINUTES = 10 * 60 * 1000;

test.use({ suiteId: __filename });

test('Explore runner - wait for agent commands', async ({ app }) => {
	test.setTimeout(TEN_MINUTES);

	// Tracing is already started by the test framework (_test.setup.ts).
	// The trace will be saved automatically as a test attachment on completion.
	// View with: npx playwright show-trace <path-from-test-output>

	const { donePromise, cleanup } = startServer(app);

	try {
		// Wait for either the /done signal or timeout
		await Promise.race([
			donePromise,
			new Promise<void>((_, reject) =>
				setTimeout(() => reject(new Error('Explore runner timed out after 10 minutes')), TEN_MINUTES)
			),
		]);
	} finally {
		cleanup();
	}
});
