/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as positron from 'positron';
import { runtimeManager } from '../extension';
import { currentRInstallation, makeMetadata, rRuntimeDiscoverer } from '../provider';

/** Every record the R search yields, in order. */
async function searchAll(): Promise<positron.LanguageRuntimeMetadata[]> {
	const runtimes: positron.LanguageRuntimeMetadata[] = [];
	for await (const runtime of rRuntimeDiscoverer()) {
		runtimes.push(runtime);
	}
	return runtimes;
}

// These run the real R search, so they need R installed.
suite('R startup recommendation', () => {
	test('the search never asks for R to start right away', async () => {
		const runtimes = await searchAll();
		assert.ok(runtimes.length > 0, 'expected the search to find R');
		assert.deepStrictEqual(
			runtimes.map(runtime => runtime.startupBehavior),
			runtimes.map(() => positron.LanguageRuntimeStartupBehavior.Implicit),
		);
	});

	test('the quick path picks the R the search lists first, with the same runtime ID', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		const quick = await makeMetadata(current);
		const [first] = await searchAll();
		assert.strictEqual(quick.runtimeId, first.runtimeId);
	});

	test('validateMetadata keeps the saved startup behavior', async () => {
		const [saved] = await searchAll();
		const validated = await Promise.all([
			positron.LanguageRuntimeStartupBehavior.Implicit,
			positron.LanguageRuntimeStartupBehavior.Immediate,
		].map(async startupBehavior => (await runtimeManager.validateMetadata({ ...saved, startupBehavior })).startupBehavior));
		assert.deepStrictEqual(validated, [
			positron.LanguageRuntimeStartupBehavior.Implicit,
			positron.LanguageRuntimeStartupBehavior.Immediate,
		]);
	});
});
