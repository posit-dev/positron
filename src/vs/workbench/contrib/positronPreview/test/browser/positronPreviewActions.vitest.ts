/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronOpenUrlInViewerAction } from '../../browser/positronPreviewActions.js';
import { IPositronPreviewService } from '../../browser/positronPreviewSevice.js';
import { IPreviewSurface } from '../../browser/previewSurface.js';
import { PreviewWebview } from '../../browser/previewWebview.js';

describe('PositronOpenUrlInViewerAction', () => {
	const onDidLoad = new Emitter<string>();

	const ctx = createLightTestContainer()
		.stub(IPositronPreviewService, {
			openUri: () => stubInterface<PreviewWebview>({ surface: stubInterface<IPreviewSurface>({ onDidLoad: onDidLoad.event }) }),
		})
		.stub(IQuickInputService, {})
		.stub(IOpenerService, { resolveExternalUri: async (uri: URI) => ({ resolved: uri, dispose: () => { } }) })
		.build();

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Runs the action, noting when it settles. */
	function open(waitForLoad?: boolean) {
		const state = { settled: false };
		const promise = ctx.instantiationService.invokeFunction(accessor =>
			new PositronOpenUrlInViewerAction().run(accessor, 'http://localhost:8000', waitForLoad));
		promise.then(() => state.settled = true, () => state.settled = true);
		return { promise, state };
	}

	it('returns without waiting for the page by default', async () => {
		await open().promise;
	});

	it('with waitForLoad, returns once the page has loaded', async () => {
		const { promise, state } = open(true);
		await vi.waitFor(() => expect(onDidLoad.hasListeners()).toBe(true));
		expect(state.settled).toBe(false);

		onDidLoad.fire('App');

		await promise;
	});

	it('with waitForLoad, fails when the page doesn\'t load in time', async () => {
		vi.useFakeTimers();
		const { promise } = open(true);
		const failure = expect(promise).rejects.toThrow('didn\'t finish loading within 30 seconds');

		await vi.advanceTimersByTimeAsync(30_000);

		await failure;
		expect(onDidLoad.hasListeners()).toBe(false);
	});
});
