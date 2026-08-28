/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// The service resolves its bundled HTML with FileAccess.asFileUri, which needs
// globalThis._VSCODE_FILE_ROOT. A bootstrap entry point normally sets that; a
// plain Vitest run doesn't go through one, so set it here.
vi.hoisted(() => {
	globalThis._VSCODE_FILE_ROOT = new URL('../../../../../../..', import.meta.url).pathname;
});

import { Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronHelpService } from '../../browser/positronHelpService.js';

const START_PROXY_COMMAND = 'positronProxy.startHelpProxyServer';
const TARGET_URL = 'http://localhost:1234/library/graphics/html/plot.html';

describe('PositronHelpService', () => {
	// The origin the extension host's PositronProxy currently reports. Tests
	// reassign this to stand in for a proxy server that moved, which is what
	// happens across an extension host restart.
	let proxyOrigin: string | undefined;

	const executeCommand = vi.fn(async (command: string) =>
		command === START_PROXY_COMMAND ? proxyOrigin : undefined
	);
	const notifyError = vi.fn();

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(ICommandService, { executeCommand })
		.stub(INotificationService, { error: notifyError })
		// The service reads its bundled HTML in the constructor. Rejecting
		// keeps the welcome page out of these tests; the failure is handled
		// internally and only affects the HTML the pane would render.
		.stub(IFileService, { readFile: () => Promise.reject(new Error('not needed')) })
		.stub(IThemeService, { onDidColorThemeChange: Event.None })
		.stub(IRuntimeSessionService, { onDidChangeRuntimeState: Event.None })
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
});
