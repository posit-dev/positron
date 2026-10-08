/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
/// <reference types="vitest/globals" />

import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { WindowIgnoreMenuShortcutsManager } from '../../electron-browser/windowIgnoreMenuShortcutsManager.js';

describe('WindowIgnoreMenuShortcutsManager', () => {
	const disposables = ensureNoLeakedDisposables();

	it.each([
		{ event: 'didFocus', enabled: true },
		{ event: 'didBlur', enabled: false },
	] as const)('sends the webview ID as the owner on $event', ({ event, enabled }) => {
		const call = vi.fn().mockResolvedValue(undefined);
		const channel = stubInterface<IChannel>({ call });
		const configuration = new TestConfigurationService({ window: { titleBarStyle: 'native' } });
		disposables.add(configuration.onDidChangeConfigurationEmitter);
		const manager = new WindowIgnoreMenuShortcutsManager(
			'webview-A', configuration,
			stubInterface<IMainProcessService>({ getChannel: () => channel }),
			stubInterface<INativeHostService>({ windowId: 42 }),
		);

		manager[event]();

		expect(call.mock.calls).toEqual([['setIgnoreMenuShortcuts', [
			{ windowId: 42, webviewId: 'webview-A' }, enabled,
		]]]);
	});
});
// --- End Positron ---
