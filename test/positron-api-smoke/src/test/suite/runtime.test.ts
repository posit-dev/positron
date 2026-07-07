/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { tryAcquirePositronApi } from '@posit-dev/positron';

/**
 * Settles the open question from #14530's --disable-extensions discussion:
 * do Positron's built-in runtime providers (positron-python / positron-r) still
 * activate and register runtimes when the test host is launched with
 * --disable-extensions? If so, a third-party author can keep that flag on and
 * still exercise runtime-dependent positron.* APIs.
 *
 * Runtime discovery is asynchronous, so we poll until at least one runtime is
 * registered or a generous timeout elapses.
 */
suite('Positron runtime providers under --disable-extensions', () => {
	test('built-in providers register at least one runtime', async function () {
		this.timeout(120_000);

		const positron = tryAcquirePositronApi();
		assert.ok(positron, 'tryAcquirePositronApi() returned undefined');

		// Discovery is async and providers register at different speeds (R is
		// near-instant; Python interpreter discovery is slower). Don't exit on the
		// first runtime - keep polling until the set stops growing for a grace
		// window, so the reported languages reflect everything that registers.
		const deadline = Date.now() + 90_000;
		const graceMs = 10_000;
		let runtimes = await positron.runtime.getRegisteredRuntimes();
		let lastChange = Date.now();
		let lastCount = runtimes.length;
		while (Date.now() < deadline && (runtimes.length === 0 || Date.now() - lastChange < graceMs)) {
			await new Promise((r) => setTimeout(r, 1000));
			runtimes = await positron.runtime.getRegisteredRuntimes();
			if (runtimes.length !== lastCount) {
				lastCount = runtimes.length;
				lastChange = Date.now();
			}
		}

		const languages = [...new Set(runtimes.map((r) => r.languageName))].sort();
		console.log(`Registered runtimes under --disable-extensions: ${runtimes.length} [${languages.join(', ')}]`);

		assert.ok(
			runtimes.length > 0,
			'No runtimes registered - built-in runtime providers did not register runtimes under --disable-extensions',
		);
	});
});
