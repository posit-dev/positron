/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookOutputWebview, IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { PositronWebviewPreloadService } from '../../browser/positronWebviewPreloadsService.js';
import { ILanguageRuntimeMessageWebOutput } from '../../../../services/languageRuntime/common/languageRuntimeService.js';

/**
 * Coverage for the generic renderer-extension webview fallback: outputs whose
 * preferred mime type has a registered notebook renderer (but no native
 * Positron rendering) are hosted in the shared renderer-runtime webview via
 * `addNotebookOutput({ rendererMime })`.
 */
describe('Positron - PositronWebviewPreloadService renderer-extension fallback', () => {
	interface FakeWebview extends INotebookOutputWebview { disposed: boolean }
	const created: FakeWebview[] = [];
	const multiMessageCalls: { runtimeId: string; preReqMessages: ILanguageRuntimeMessageWebOutput[]; displayMessage: ILanguageRuntimeMessageWebOutput }[] = [];

	function makeFakeWebview(id: string): FakeWebview {
		const fake: FakeWebview = {
			id,
			sessionId: 'test-session',
			disposed: false,
			webview: stubInterface<IOverlayWebview>(),
			onDidRender: Event.None,
			dispose: () => {
				fake.disposed = true;
			},
		};
		created.push(fake);
		return fake;
	}

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IPositronNotebookOutputWebviewService, {
			createMultiMessageWebview: (args: typeof multiMessageCalls[number]) => {
				multiMessageCalls.push(args);
				return Promise.resolve(makeFakeWebview(args.displayMessage.id));
			},
		})
		.build();

	let service: PositronWebviewPreloadService;

	beforeEach(() => {
		created.length = 0;
		multiMessageCalls.length = 0;
		service = ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronWebviewPreloadService)
		);
	});

	const NOTEBOOK_URI = URI.parse('test:///renderer-fallback/notebook.ipynb');

	function makeInstance() {
		const instance = stubInterface<IPositronNotebookInstance>({
			getId: () => 'renderer-fallback-notebook',
			uri: NOTEBOOK_URI,
			textModel: undefined,
			onDidChangeModel: Event.None,
		});
		service.attachNotebookInstance(instance);
		return instance;
	}

	function vegaliteOutputs(spec = '{"mark": "point"}') {
		return [
			{ mime: 'application/vnd.vegalite.v5+json', data: VSBuffer.fromString(spec) },
			{ mime: 'text/plain', data: VSBuffer.fromString('<VegaLite chart>') },
		];
	}

	it('creates a renderer-runtime webview for a rendererMime output', async () => {
		const instance = makeInstance();

		const result = service.addNotebookOutput({
			instance,
			outputId: 'output-1',
			outputs: vegaliteOutputs(),
			rendererMime: 'application/vnd.vegalite.v5+json',
		});

		expect(result?.preloadMessageType).toBe('display');
		if (result?.preloadMessageType !== 'display') {
			throw new Error('expected a display result');
		}
		const webview = await result.webview;
		expect(webview.id).toBe('output-1');

		// The renderer webview renders just this output; no stored preload
		// messages are replayed.
		expect(multiMessageCalls.length).toBe(1);
		expect(multiMessageCalls[0].preReqMessages).toEqual([]);
		expect(Object.keys(multiMessageCalls[0].displayMessage.data)).toContain('application/vnd.vegalite.v5+json');
	});

	it('reuses the webview for unchanged content and rebuilds on change', async () => {
		const instance = makeInstance();
		const opts = {
			instance,
			outputId: 'output-1',
			outputs: vegaliteOutputs(),
			rendererMime: 'application/vnd.vegalite.v5+json',
		};

		const first = service.addNotebookOutput(opts);
		const second = service.addNotebookOutput(opts);
		expect(multiMessageCalls.length, 'same content must reuse the cached webview').toBe(1);
		if (first?.preloadMessageType !== 'display' || second?.preloadMessageType !== 'display') {
			throw new Error('expected display results');
		}
		const firstWebview = await first.webview;
		expect(await second.webview).toBe(firstWebview);

		// Changed content under the same output ID rebuilds and disposes the old webview.
		const third = service.addNotebookOutput({
			...opts,
			outputs: vegaliteOutputs('{"mark": "bar"}'),
		});
		if (third?.preloadMessageType !== 'display') {
			throw new Error('expected a display result');
		}
		const thirdWebview = await third.webview;
		expect(multiMessageCalls.length).toBe(2);
		expect(thirdWebview).not.toBe(firstWebview);
		expect((firstWebview as FakeWebview).disposed, 'stale webview must be disposed').toBe(true);
	});
});
