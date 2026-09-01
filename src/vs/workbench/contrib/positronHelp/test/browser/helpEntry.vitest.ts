/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IColorTheme, IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IOverlayWebview, IWebviewService, WebviewMessageReceivedEvent } from '../../../webview/browser/webview.js';
import { HelpEntry } from '../../browser/helpEntry.js';

type HelpMessage = {
	readonly id: string;
	readonly findValue?: string;
};

// The help topic as the runtime's own help server serves it. This is the help
// entry's stable identity; it outlives an extension host restart.
const LOCALHOST_HELP_URL = 'http://localhost/help/library/graphics/html/plot.html';

// The same topic as a help proxy server serves it. The proxy server lives in
// the extension host, so a restart replaces it with one on another port.
const PROXIED_HELP_URL = 'http://127.0.0.1:5001/help/library/graphics/html/plot.html';
const RESTARTED_PROXIED_HELP_URL = 'http://127.0.0.1:5999/help/library/graphics/html/plot.html';

describe('HelpEntry', () => {
	let messages: HelpMessage[];
	let navigated: string[];
	let helpEntry: HelpEntry;

	// The source URL the resolver hands back right now. Tests reassign this to
	// stand in for an extension host restart, which leaves the previously
	// resolved source URL naming a proxy server that is gone.
	let sourceUrl: string;

	// Emitter used to simulate messages posted from the help webview (e.g. a
	// link click). Created at describe scope so the webview stub can hand out
	// its `.event` reference; fired from individual tests.
	const onMessageEmitter = new Emitter<WebviewMessageReceivedEvent>();
	const onDidColorThemeChangeEmitter = new Emitter<IColorTheme>();
	const open = vi.fn(async () => true);
	const setHtml = vi.fn((_html: string) => { });

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
		setHtml,
		claim: () => { },
		release: () => { },
		setAnchorElement: () => { },
		hideFind: () => { },
		dispose: () => { },
		reload: () => { },
	});

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IWebviewService, {
			createWebviewOverlay: () => overlayWebview(),
		})
		.stub(IOpenerService, { open })
		.stub(IThemeService, { onDidColorThemeChange: onDidColorThemeChangeEmitter.event })
		.build();

	/**
	 * Gets the source URL the help overlay webview was last loaded from.
	 */
	const loadedSourceUrl = () =>
		setHtml.mock.lastCall?.[0].match(/<html>(?<sourceUrl>.*)<\/html>/)?.groups?.sourceUrl;

	/**
	 * Shows the help entry over a fresh anchor element and lets the load settle.
	 */
	async function showHelpEntry(): Promise<void> {
		const anchor = document.createElement('div');
		Object.defineProperty(anchor, 'getBoundingClientRect', {
			value: () => ({ x: 0, y: 0, width: 100, height: 100 }),
		});
		document.body.appendChild(anchor);
		helpEntry.showHelpOverlayWebview(anchor);

		// The help entry resolves its source URL as it loads, so let the load
		// settle before the test posts messages from the webview.
		await vi.runAllTimersAsync();
	}

	async function createHelpEntry(initialSourceUrl: string = LOCALHOST_HELP_URL): Promise<void> {
		messages = [];
		navigated = [];
		sourceUrl = initialSourceUrl;

		helpEntry = ctx.disposables.add(ctx.instantiationService.createInstance(
			HelpEntry,
			'<html>__sourceURL__</html>',
			'r',
			'test-session',
			'R',
			URI.parse(LOCALHOST_HELP_URL).toString(),
			async () => sourceUrl,
		));

		// The help service listens for navigation and opens the next help
		// entry; stand in for it here.
		ctx.disposables.add(helpEntry.onDidNavigate(toTargetUrl => navigated.push(toTargetUrl)));

		await showHelpEntry();
	}

	afterEach(() => {
		helpEntry?.dispose();
		document.body.replaceChildren();
	});

	describe('Source URL resolution', () => {
		it('resolves the source URL again when a hidden entry is shown once more', async () => {
			vi.useFakeTimers();
			await createHelpEntry(PROXIED_HELP_URL);

			// Hide the entry long enough for its webview to be disposed, then
			// bring it back to a proxy server that has moved, as it would have
			// while the entry was off-screen across an extension host restart.
			helpEntry.hideHelpOverlayWebview(true);
			await vi.runAllTimersAsync();
			sourceUrl = RESTARTED_PROXIED_HELP_URL;
			await showHelpEntry();

			expect(loadedSourceUrl()).toBe(RESTARTED_PROXIED_HELP_URL);
		});

		it('resolves the source URL again when the color theme changes', async () => {
			vi.useFakeTimers();
			await createHelpEntry(PROXIED_HELP_URL);

			sourceUrl = RESTARTED_PROXIED_HELP_URL;
			onDidColorThemeChangeEmitter.fire(stubInterface<IColorTheme>());
			await vi.runAllTimersAsync();

			expect(loadedSourceUrl()).toBe(RESTARTED_PROXIED_HELP_URL);
		});
	});

	describe('Find navigation', () => {
		it('advances without moving focus into the Help webview', async () => {
			vi.useFakeTimers();
			await createHelpEntry();

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
			await createHelpEntry('welcome.html');

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
			await createHelpEntry();

			const sameOriginUrl = 'http://localhost/help/library/graphics/html/hist.html';
			onMessageEmitter.fire({
				message: { id: 'positron-help-navigate', url: sameOriginUrl },
			});
			await vi.runAllTimersAsync();

			expect(navigated).toEqual([sameOriginUrl]);
			expect(open).not.toHaveBeenCalled();
		});

		it('reports a clicked link as a target URL, not the proxied URL', async () => {
			vi.useFakeTimers();
			await createHelpEntry(PROXIED_HELP_URL);

			// A link click reaches us as the URL the webview navigated to, which
			// carries the proxy server's origin. It becomes the next help
			// entry's target URL, so it has to be converted back to the
			// runtime's own help server or it can't be proxied again.
			onMessageEmitter.fire({
				message: {
					id: 'positron-help-navigate',
					url: 'http://127.0.0.1:5001/help/library/graphics/html/hist.html',
				},
			});
			await vi.runAllTimersAsync();

			expect(navigated).toEqual(['http://localhost/help/library/graphics/html/hist.html']);
		});
	});
});
