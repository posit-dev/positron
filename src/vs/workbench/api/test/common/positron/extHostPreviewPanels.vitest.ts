/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { ExtHostWebview, ExtHostWebviews } from '../../../common/extHostWebview.js';
import { IMainPositronContext, MainThreadPreviewPanelShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostPreviewPanels } from '../../../common/positron/extHostPreviewPanels.js';

describe('ExtHostPreviewPanels stop button', () => {
	const disposables = ensureNoLeakedDisposables();

	/** Creates a preview panel and records the stoppable RPCs it sends to the main thread. */
	function createPanel(): { panels: ExtHostPreviewPanels; panel: positron.PreviewPanel; handle: string; rpcs: boolean[] } {
		const rpcs: boolean[] = [];
		let handle = '';
		const proxy = stubInterface<MainThreadPreviewPanelShape>({
			$createPreviewPanel: (_extension, newHandle) => { handle = newHandle; },
			$setStoppable: (_handle, stoppable) => { rpcs.push(stoppable); },
			$disposePreview: () => { },
		});
		const panels = new ExtHostPreviewPanels(
			stubInterface<IMainPositronContext>({ getProxy: (<T>() => proxy as T) as IMainPositronContext['getProxy'] }),
			stubInterface<ExtHostWebviews>({
				$createNewWebview: () => stubInterface<ExtHostWebview>({ dispose: () => { } }),
			}),
			undefined,
		);
		const panel = disposables.add(panels.createPreviewPanel(nullExtensionDescription, 'test.view', 'Test', true, { localResourceRoots: [] }));
		return { panels, panel, handle, rpcs };
	}

	it('tells the main thread only when stoppable changes', () => {
		const { panel, rpcs } = createPanel();

		panel.stoppable = true;
		panel.stoppable = true;
		panel.stoppable = false;

		expect({ stoppable: panel.stoppable, rpcs }).toEqual({ stoppable: false, rpcs: [true, false] });
	});

	it('clears stoppable and fires onDidRequestStop when the user clicks stop', () => {
		const { panels, panel, handle, rpcs } = createPanel();
		const stopRequests: boolean[] = [];
		disposables.add(panel.onDidRequestStop(() => stopRequests.push(panel.stoppable)));
		panel.stoppable = true;

		panels.$onDidRequestStop(handle);
		// The extension can show the button again, e.g. if it decides not to stop.
		panel.stoppable = true;

		expect({ stopRequests, rpcs }).toEqual({ stopRequests: [false], rpcs: [true, false, true] });
	});

	it('ignores a stop request that arrives after the extension disposed the panel', () => {
		const { panels, panel, handle } = createPanel();
		panel.stoppable = true;
		panel.dispose();

		expect(() => panels.$onDidRequestStop(handle)).not.toThrow();
	});

	it('keeps the main thread in sync when the extension restarts while a stop request is in flight', () => {
		const { panels, panel, handle, rpcs } = createPanel();
		panel.stoppable = true;

		// The user clicks stop; before the request arrives, the extension restarts its process.
		panel.stoppable = false;
		panel.stoppable = true;
		panels.$onDidRequestStop(handle);

		// The main thread's last word must match the ext host's cached value.
		expect({ stoppable: panel.stoppable, lastRpc: rpcs.at(-1) }).toEqual({ stoppable: false, lastRpc: false });
	});
});
