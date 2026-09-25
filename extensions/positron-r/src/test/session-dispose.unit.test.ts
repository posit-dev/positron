/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Sinon from 'sinon';
import * as positron from 'positron';
import { LSP_DISPOSE_TIMEOUT_MS, RSession } from '../session';

/**
 * `deleteSession()` disposes a runtime that wouldn't exit. Kernel disposal
 * rejects the supervisor's pending sends, so it must run even when the LSP
 * cannot be stopped.
 *
 * See https://github.com/posit-dev/positron/issues/15781.
 */
suite('RSession disposal', () => {
	function createSession(lspDispose: () => Promise<void>) {
		const runtimeMetadata = {
			runtimeName: 'R 4.5.2',
			languageVersion: '4.5.2',
		} as positron.LanguageRuntimeMetadata;
		const metadata = {
			sessionId: 'r-dispose-test',
			sessionMode: positron.LanguageRuntimeSessionMode.Console,
		} as positron.RuntimeSessionMetadata;

		const session = new RSession(runtimeMetadata, metadata);
		const kernelDispose = Sinon.stub().resolves();
		const internals = session as unknown as {
			_lsp: { dispose: () => Promise<void> };
			_kernel: { dispose: () => Promise<void> };
		};
		internals._lsp = { dispose: lspDispose };
		internals._kernel = { dispose: kernelDispose };
		return { session, kernelDispose };
	}

	test('disposes the kernel when LSP disposal rejects', async () => {
		const { session, kernelDispose } = createSession(
			() => Promise.reject(new Error('Timeout while waiting for client to stop')));

		await session.dispose();

		assert.strictEqual(kernelDispose.callCount, 1);
	});

	test('disposes the kernel when LSP disposal never settles', async () => {
		const clock = Sinon.useFakeTimers({ toFake: ['setTimeout'] });
		try {
			const { session, kernelDispose } = createSession(() => new Promise<void>(() => { }));

			const disposed = session.dispose();
			await clock.tickAsync(LSP_DISPOSE_TIMEOUT_MS);
			await disposed;

			assert.strictEqual(kernelDispose.callCount, 1);
		} finally {
			clock.restore();
		}
	});
});
