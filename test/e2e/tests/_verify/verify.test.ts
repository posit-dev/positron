/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { TestTags } from '../../infra';
import { startServer } from './server';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const title = process.env.EXPLORE_TITLE || 'wait for agent commands';

test.use({ suiteId: __filename });

test(`/e2e-test-verify runner - ${title}`, { tag: [TestTags.WEB, TestTags.CROSS_BROWSER] }, async ({ app }) => {
	test.setTimeout(FIFTEEN_MINUTES);

	// Tracing is already started by the test framework (_test.setup.ts).
	// The trace will be saved automatically as a test attachment on completion.
	// View with: npx playwright show-trace <path-from-test-output>

	const { donePromise, cleanup } = startServer(app, test.info());

	try {
		// Wait for either the /done signal or timeout
		await Promise.race([
			donePromise,
			new Promise<void>((_, reject) =>
				setTimeout(() => reject(new Error('Verify runner timed out after 15 minutes')), FIFTEEN_MINUTES)
			),
		]);
	} finally {
		cleanup();
	}
});
