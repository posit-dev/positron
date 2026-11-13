/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { inPositron, tryAcquirePositronApi } from '@posit-dev/positron';

suite('Positron API smoke', () => {
	test('acquires a live Positron API in the downloaded extension host', () => {
		// The global accessor should have been injected by Positron's bootstrap.
		assert.strictEqual(inPositron(), true, 'acquirePositronApi global was not injected');

		const positron = tryAcquirePositronApi();
		assert.ok(positron, 'tryAcquirePositronApi() returned undefined - API is not live');

		// Trivial, synchronous top-level members prove the object is a real API handle.
		assert.strictEqual(typeof positron.version, 'string');
		assert.ok(positron.version.length > 0, 'positron.version was empty');
		assert.ok(positron.buildNumber !== undefined, 'positron.buildNumber was undefined');

		// Surfaced in the test output so the run records which build answered.
		// Note: positron.d.ts declares buildNumber as `number`, but the runtime
		// value is a string - a typings/runtime discrepancy captured in the README.
		console.log(
			`Live Positron API: version=${positron.version} (${typeof positron.version}) ` +
			`buildNumber=${positron.buildNumber} (${typeof positron.buildNumber})`,
		);
	});
});
