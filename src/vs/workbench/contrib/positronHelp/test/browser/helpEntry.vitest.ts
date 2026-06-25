/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IOverlayWebview, IWebviewService } from '../../../webview/browser/webview.js';
import { HelpEntry } from '../../browser/helpEntry.js';

type HelpMessage = {
	readonly id: string;
	readonly findValue?: string;
};

describe('HelpEntry', () => {
	let messages: HelpMessage[];
	let helpEntry: HelpEntry;

	const overlayWebview = (): IOverlayWebview => stubInterface<IOverlayWebview>({
		container: document.createElement('div'),
		origin: 'test-origin',
		options: {},
		onDidFocus: Event.None,
		onDidBlur: Event.None,
		onDidDispose: Event.None,
		onDidClickLink: Event.None,
		onDidScroll: Event.None,
		onDidWheel: Event.None,
		onDidUpdateState: Event.None,
		onFatalError: Event.None,
		onMissingCsp: Event.None,
		onMessage: Event.None,
		onDidNavigate: Event.None,
		onDidLoad: Event.None,
		intrinsicContentSize: undefined,
		postMessage: async message => {
			messages.push(message as HelpMessage);
			return true;
		},
		setHtml: () => { },
		claim: () => { },
		setAnchorElement: () => { },
		dispose: () => { },
		reload: () => { },
	});

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IWebviewService, {
			createWebviewOverlay: () => overlayWebview(),
		})
		.build();

	function createHelpEntry(): void {
		messages = [];

		helpEntry = ctx.disposables.add(ctx.instantiationService.createInstance(
			HelpEntry,
			'<html>__sourceURL__</html>',
			'r',
			'test-session',
			'R',
			'http://localhost/help/library/graphics/html/plot.html',
			URI.parse('http://localhost/help/library/graphics/html/plot.html').toString(),
		));

		const anchor = document.createElement('div');
		Object.defineProperty(anchor, 'getBoundingClientRect', {
			value: () => ({ x: 0, y: 0, width: 100, height: 100 }),
		});
		document.body.appendChild(anchor);
		helpEntry.showHelpOverlayWebview(anchor);
	}

	afterEach(() => {
		helpEntry?.dispose();
		document.body.replaceChildren();
	});

	describe('Find navigation', () => {
		it('advances without moving focus into the Help webview', async () => {
			vi.useFakeTimers();
			createHelpEntry();

			helpEntry.find('title', false);
			await vi.runAllTimersAsync();

			expect(messages).toEqual([{ id: 'positron-help-find-next', findValue: 'title' }]);
		});
	});
});
