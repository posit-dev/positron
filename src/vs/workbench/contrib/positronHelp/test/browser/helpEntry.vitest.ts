/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IOverlayWebview, IWebviewService, WebviewMessageReceivedEvent } from '../../../webview/browser/webview.js';
import { HelpEntry } from '../../browser/helpEntry.js';

type HelpMessage = {
	readonly id: string;
	readonly findValue?: string;
};

const LOCALHOST_HELP_URL = 'http://localhost/help/library/graphics/html/plot.html';

describe('HelpEntry', () => {
	let messages: HelpMessage[];
	let helpEntry: HelpEntry;

	// Emitter used to simulate messages posted from the help webview (e.g. a
	// link click). Created at describe scope so the webview stub can hand out
	// its `.event` reference; fired from individual tests.
	const onMessageEmitter = new Emitter<WebviewMessageReceivedEvent>();
	const open = vi.fn(async () => true);

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
		onMessage: onMessageEmitter.event,
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
		.stub(IOpenerService, { open })
		.build();

	function createHelpEntry(sourceUrl: string = LOCALHOST_HELP_URL): void {
		messages = [];

		helpEntry = ctx.disposables.add(ctx.instantiationService.createInstance(
			HelpEntry,
			'<html>__sourceURL__</html>',
			'r',
			'test-session',
			'R',
			sourceUrl,
			URI.parse(LOCALHOST_HELP_URL).toString(),
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

	describe('Link navigation', () => {
		it('opens external links from the welcome page whose source URL is relative', async () => {
			vi.useFakeTimers();
			// The welcome page uses a relative source URL ('welcome.html'), which
			// is not a valid absolute URL. See issue #14810.
			createHelpEntry('welcome.html');

			onMessageEmitter.fire({
				message: {
					id: 'positron-help-navigate',
					url: 'https://github.com/posit-dev/positron/discussions',
				},
			});
			await vi.runAllTimersAsync();

			expect(open).toHaveBeenCalledWith(
				'https://github.com/posit-dev/positron/discussions',
				{ openExternal: true },
			);
		});

		it('navigates internally for same-origin help links', async () => {
			vi.useFakeTimers();
			createHelpEntry();
			const navigated: string[] = [];
			ctx.disposables.add(helpEntry.onDidNavigate(url => navigated.push(url.toString())));

			const sameOriginUrl = 'http://localhost/help/library/graphics/html/hist.html';
			onMessageEmitter.fire({
				message: { id: 'positron-help-navigate', url: sameOriginUrl },
			});
			await vi.runAllTimersAsync();

			expect(navigated).toEqual([sameOriginUrl]);
			expect(open).not.toHaveBeenCalled();
		});
	});
});
