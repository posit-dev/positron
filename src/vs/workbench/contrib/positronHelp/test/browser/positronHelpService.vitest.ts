/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The service resolves its bundled HTML with FileAccess.asFileUri, which needs
// globalThis._VSCODE_FILE_ROOT. A bootstrap entry point normally sets that; a
// plain Vitest run doesn't go through one, so set it here. Assigning through
// Object.assign rather than naming the property keeps this free of editor
// diagnostics: the declaration lives in src/typings, which the fallback project
// the editor uses for .vitest.ts files doesn't load.
vi.hoisted(() => {
	Object.assign(globalThis, {
		_VSCODE_FILE_ROOT: new URL('../../../../../../..', import.meta.url).pathname
	});
});

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { HelpClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeHelpClient.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ShowHelpEvent, ShowHelpKind } from '../../../../services/languageRuntime/common/positronHelpComm.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { HelpTopicResult, PositronHelpService } from '../../browser/positronHelpService.js';

const START_PROXY_COMMAND = 'positronProxy.startHelpProxyServer';
const TARGET_URL = 'http://localhost:1234/library/graphics/html/plot.html';

describe('PositronHelpService', () => {
	// The origin the extension host's PositronProxy currently reports. Tests
	// reassign this to stand in for a proxy server that moved, which is what
	// happens across an extension host restart.
	let proxyOrigin: string | undefined;

	const executeCommand = vi.fn(async (command: string, ..._args: unknown[]) =>
		command === START_PROXY_COMMAND ? proxyOrigin : undefined
	);
	const notifyError = vi.fn();

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(ICommandService, { executeCommand })
		.stub(INotificationService, { error: notifyError })
		// The service reads its bundled HTML in the constructor. Rejecting
		// keeps the welcome page out of these tests; the failure is handled
		// internally and only affects the HTML the pane would render.
		.stub(IFileService, { readFile: () => Promise.reject(new Error('not needed')) })
		.stub(IThemeService, { onDidColorThemeChange: Event.None })
		.stub(IViewsService, { openView: () => Promise.resolve(null) })
		.stub(IContextKeyService, new MockContextKeyService())
		.stub(IRuntimeSessionService, { onDidChangeRuntimeState: Event.None, onDidChangeForegroundSession: Event.None })
		.build();

	const createService = () =>
		ctx.disposables.add(ctx.instantiationService.createInstance(PositronHelpService));

	beforeEach(() => {
		proxyOrigin = 'http://127.0.0.1:5001';
	});

	it('loads a target URL the runtime does not serve as-is', async () => {
		const sourceUrl = await createService().resolveSourceUrl('welcome.html');

		expect({
			sourceUrl,
			askedProxy: executeCommand.mock.calls.some(([c]) => c === START_PROXY_COMMAND),
		}).toMatchInlineSnapshot(`
			{
			  "askedProxy": false,
			  "sourceUrl": "welcome.html",
			}
		`);
	});

	it('builds the source URL from the proxy origin reported at resolve time', async () => {
		const sourceUrl = await createService().resolveSourceUrl(TARGET_URL);

		expect(sourceUrl).toMatchInlineSnapshot(`"http://127.0.0.1:5001/library/graphics/html/plot.html"`);
	});

	it('asks the proxy on every resolve instead of reusing the first origin', async () => {
		const helpService = createService();

		const first = await helpService.resolveSourceUrl(TARGET_URL);
		// Stand in for an extension host restart: the old proxy server is gone
		// and PositronProxy answers with a new one.
		proxyOrigin = 'http://127.0.0.1:5999';
		const second = await helpService.resolveSourceUrl(TARGET_URL);

		expect({
			first,
			second,
			proxyCalls: executeCommand.mock.calls.filter(([c]) => c === START_PROXY_COMMAND).length,
		}).toMatchInlineSnapshot(`
			{
			  "first": "http://127.0.0.1:5001/library/graphics/html/plot.html",
			  "proxyCalls": 2,
			  "second": "http://127.0.0.1:5999/library/graphics/html/plot.html",
			}
		`);
	});

	it('reports the service as unavailable when no proxy server can be started', async () => {
		proxyOrigin = undefined;

		const sourceUrl = await createService().resolveSourceUrl(TARGET_URL);

		expect({ sourceUrl, notified: notifyError.mock.calls.length }).toMatchInlineSnapshot(`
			{
			  "notified": 1,
			  "sourceUrl": undefined,
			}
		`);
	});

	describe('foreground help requests', () => {
		let session: ILanguageRuntimeSession;
		let foregroundSession: ILanguageRuntimeSession | undefined;
		let state: RuntimeState;
		let service: PositronHelpService;
		const showHelpTopic = vi.fn<HelpClientInstance['showHelpTopic']>();
		const searchHelp = vi.fn<HelpClientInstance['searchHelp']>();

		beforeEach(() => {
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'r-session',
				getRuntimeState: () => state,
				onDidChangeRuntimeState: Event.None,
			});
			foregroundSession = session;
			state = RuntimeState.Idle;
			ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
				get foregroundSession() { return foregroundSession; },
				onDidChangeForegroundSession: Event.None,
				onDidChangeRuntimeState: Event.None,
			}));
			service = createService();
			showHelpTopic.mockReset().mockResolvedValue(true);
			searchHelp.mockReset().mockResolvedValue(false);
		});

		const attachClient = () => service.attachClientInstance(session, stubInterface<HelpClientInstance>({
			showHelpTopic,
			searchHelp,
			onDidEmitHelpContent: Event.None,
			onDidClose: Event.None,
			dispose: () => { },
		}));

		describe('exact topics', () => {
			it.each([
				{ found: true, result: HelpTopicResult.Found },
				{ found: false, result: HelpTopicResult.NotFound },
			])('returns $result when the foreground client returns $found', async ({ found, result }) => {
				attachClient();
				showHelpTopic.mockResolvedValue(found);

				expect({
					result: await service.showHelpTopicForForegroundSession('plot', undefined, CancellationToken.None),
					requests: showHelpTopic.mock.calls,
				}).toEqual({ result, requests: [['plot', undefined]] });
			});

			it('forwards a literal alias and its package unchanged', async () => {
				attachClient();
				showHelpTopic.mockResolvedValue(true);
				expect(await service.showHelpTopicForForegroundSession(':=', 'data.table', CancellationToken.None)).toBe(HelpTopicResult.Found);
				expect(showHelpTopic).toHaveBeenCalledExactlyOnceWith(':=', 'data.table');
			});

			it('returns unavailable when the foreground session has ended', async () => {
				attachClient();
				state = RuntimeState.Exited;
				await expect(service.showHelpTopicForForegroundSession('plot', undefined, CancellationToken.None)).resolves.toBe(HelpTopicResult.Unavailable);
				expect(showHelpTopic).not.toHaveBeenCalled();
			});

			it('returns unavailable without a foreground session even when another client is attached', async () => {
				attachClient();
				foregroundSession = undefined;

				expect({
					result: await service.showHelpTopicForForegroundSession('plot', undefined, CancellationToken.None),
					requests: showHelpTopic.mock.calls,
				}).toEqual({ result: HelpTopicResult.Unavailable, requests: [] });
			});

			it('propagates a genuine topic request error', async () => {
				attachClient();
				const error = new Error('Help request failed');
				showHelpTopic.mockRejectedValue(error);

				await expect(service.showHelpTopicForForegroundSession('plot', undefined, CancellationToken.None)).rejects.toBe(error);
			});
		});

		describe('search', () => {
			it('returns false when the foreground session has ended', async () => {
				attachClient();
				state = RuntimeState.Exited;
				await expect(service.searchHelp('linear model', CancellationToken.None)).resolves.toBe(false);
				expect(searchHelp).not.toHaveBeenCalled();
			});

			it('returns false without a foreground session even when another client is attached', async () => {
				attachClient();
				foregroundSession = undefined;

				expect({
					result: await service.searchHelp('linear model', CancellationToken.None),
					requests: searchHelp.mock.calls,
				}).toEqual({ result: false, requests: [] });
			});

			it('returns false when the foreground client does not accept the search', async () => {
				attachClient();

				expect({
					result: await service.searchHelp('linear model', CancellationToken.None),
					requests: searchHelp.mock.calls,
				}).toEqual({ result: false, requests: [['linear model', expect.any(String)]] });
			});

			it('propagates a genuine search request error', async () => {
				attachClient();
				const error = new Error('Help search failed');
				searchHelp.mockRejectedValue(error);

				await expect(service.searchHelp('linear model', CancellationToken.None)).rejects.toBe(error);
			});
		});
	});

	describe('when a help client closes', () => {
		let service: PositronHelpService;
		let session: ILanguageRuntimeSession;

		beforeEach(() => {
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'r-session',
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId: 'r', languageName: 'R' }),
				onDidChangeRuntimeState: Event.None,
			});
			service = createService();
			executeCommand.mockClear();
		});

		const attachClient = () => {
			const helpEvents = ctx.disposables.add(new Emitter<ShowHelpEvent>());
			const closeEvents = ctx.disposables.add(new Emitter<void>());
			service.attachClientInstance(session, stubInterface<HelpClientInstance>({
				onDidEmitHelpContent: helpEvents.event,
				onDidClose: closeEvents.event,
				dispose: () => { },
			}));
			const show = async (content: string) => {
				helpEvents.fire({ content, kind: ShowHelpKind.Url, focus: false });
				await vi.waitFor(() => expect(service.currentHelpEntry?.targetUrl).toBe(content));
			};
			return { show, close: () => closeEvents.fire() };
		};

		const state = () => ({
			entries: service.helpEntries.map(helpEntry => helpEntry.targetUrl),
			current: service.currentHelpEntry?.targetUrl,
			stopped: executeCommand.mock.calls.filter(([c]) => c === 'positronProxy.stopProxyServer').map(([, origin]) => origin),
		});

		it('keeps only the current page, stops its proxy, and drops the page once it is left', async () => {
			const client = attachClient();
			await client.show('http://localhost:1234/a.html');
			await client.show('http://localhost:1234/b.html');
			service.navigateBackward();

			client.close();
			const afterClose = state();

			// The session restarts and its new help server shows a page.
			await attachClient().show('http://localhost:5678/c.html');

			expect({ afterClose, afterRestart: state() }).toMatchInlineSnapshot(`
				{
				  "afterClose": {
				    "current": "http://localhost:1234/a.html",
				    "entries": [
				      "http://localhost:1234/a.html",
				    ],
				    "stopped": [
				      "http://localhost:1234",
				    ],
				  },
				  "afterRestart": {
				    "current": "http://localhost:5678/c.html",
				    "entries": [
				      "http://localhost:5678/c.html",
				    ],
				    "stopped": [
				      "http://localhost:1234",
				    ],
				  },
				}
			`);
		});
	});
});
