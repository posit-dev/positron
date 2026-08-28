/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { HelpClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeHelpClient.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ShowHelpEvent, ShowHelpKind } from '../../../../services/languageRuntime/common/positronHelpComm.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronHelpService } from '../../browser/positronHelpService.js';

// R's help server lives in the R process and survives an extension host
// restart, so the target origin is the one thing that does not change here.
const TARGET_ORIGIN = 'http://127.0.0.1:54321';

// The help proxy servers live in the extension host, so a restart replaces them
// with new ones on new ports.
const PROXY_ORIGIN_BEFORE_RESTART = 'http://127.0.0.1:12345';
const PROXY_ORIGIN_AFTER_RESTART = 'http://127.0.0.1:23456';

describe('PositronHelpService', () => {
	// The origin the extension host would report right now. The test moves this
	// to stand in for an extension host restart.
	let proxyOrigin = PROXY_ORIGIN_BEFORE_RESTART;

	// The help client emits show-help events; created at describe scope so the
	// client stub can hand out its `.event` reference.
	const onDidEmitHelpContent = new Emitter<ShowHelpEvent>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(ICommandService, {
			executeCommand: async (command: string) =>
				command === 'positronProxy.startHelpProxyServer' ? proxyOrigin : undefined,
		})
		// The constructor reads the bundled help and welcome HTML on startup.
		.stub(IFileService, {
			readFile: async () => stubInterface<IFileContent>({
				value: VSBuffer.fromString('<html></html>'),
			}),
		})
		// WebviewThemeDataProvider reads the editor configuration to build the
		// styles handed to the proxy server.
		.stub(IConfigurationService, {
			getValue: () => ({}),
			onDidChangeConfiguration: Event.None,
		})
		.build();

	beforeEach(() => {
		proxyOrigin = PROXY_ORIGIN_BEFORE_RESTART;
	});

	function createHelpService() {
		// The constructor resolves the bundled help HTML through FileAccess,
		// which has no module id to resolve against under Vitest.
		vi.spyOn(FileAccess, 'asFileUri').mockReturnValue(URI.file('/test/help.html'));

		const helpService = ctx.instantiationService.createInstance(PositronHelpService);
		ctx.disposables.add(helpService);
		return helpService;
	}

	function attachHelpClient(helpService: PositronHelpService) {
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'test-session-id',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				languageId: 'r',
				languageName: 'R',
				runtimeId: 'test-runtime-id',
			}),
		});
		const client = stubInterface<HelpClientInstance>({
			onDidEmitHelpContent: onDidEmitHelpContent.event,
			onDidClose: Event.None,
			dispose: () => { },
		});
		helpService.attachClientInstance(session, client);
	}

	function showHelp(topicPath: string) {
		onDidEmitHelpContent.fire({
			content: `${TARGET_ORIGIN}${topicPath}`,
			kind: ShowHelpKind.Url,
			focus: false,
		});
	}

	// The URL asserted here is the one handed to the Help pane's webview, so it
	// is where the bug is visible: after an extension host restart the pane was
	// sent a well-formed URL pointing at a proxy port nobody is listening on.
	// Asserting the URL rather than "did we ask the proxy" leaves the choice of
	// caching strategy open, as long as a dead origin never reaches the pane.
	it('builds the help URL from the proxy origin the extension host reports now', async () => {
		const helpService = createHelpService();
		attachHelpClient(helpService);

		showHelp('/library/stats/html/acf.html');
		await vi.waitFor(() => expect(helpService.currentHelpEntry?.sourceUrl)
			.toBe(`${PROXY_ORIGIN_BEFORE_RESTART}/library/stats/html/acf.html`));

		// Stand in for an extension host restart: same R help server, new proxy.
		proxyOrigin = PROXY_ORIGIN_AFTER_RESTART;

		showHelp('/library/stats/html/lm.html');
		await vi.waitFor(() => expect(helpService.currentHelpEntry?.sourceUrl)
			.toBe(`${PROXY_ORIGIN_AFTER_RESTART}/library/stats/html/lm.html`));
	});
});
