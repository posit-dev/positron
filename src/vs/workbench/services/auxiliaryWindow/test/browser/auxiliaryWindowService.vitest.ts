/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { Barrier } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { IHostService } from '../../../host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../layout/browser/layoutService.js';
import { AuxiliaryWindow } from '../../browser/auxiliaryWindowService.js';

class TestAuxiliaryWindow extends AuxiliaryWindow {

	protected override enableWindowFocusOnElementFocus(): void { }
	protected override enableMultiWindowAwareTimeout(): void { }
}

describe('AuxiliaryWindow', () => {
	const disposables = ensureNoLeakedDisposables();

	function createAuxiliaryWindow(): AuxiliaryWindow {
		const stylesHaveLoaded = new Barrier();
		stylesHaveLoaded.open();

		return disposables.add(new TestAuxiliaryWindow(
			mainWindow,
			mainWindow.document.createElement('div'),
			stylesHaveLoaded,
			stubInterface<IConfigurationService>(),
			stubInterface<IHostService>({ onDidChangeFullScreen: Event.None }),
			stubInterface<IWorkbenchEnvironmentService>(),
			stubInterface<IContextMenuService>({
				onDidShowContextMenu: Event.None,
				onDidHideContextMenu: Event.None,
			}),
			stubInterface<IWorkbenchLayoutService>({ activeContainer: mainWindow.document.body }),
		));
	}

	// The regression this guards: the auxiliary editor part calls `updateOptions`
	// with `{ compact }` alone whenever compact mode changes, and a window that
	// replaced its option bag there would lose the chrome traits it was opened
	// with -- so every later restore came back with workbench chrome.
	it('keeps the traits it was opened with when compact state changes', () => {
		const auxiliaryWindow = createAuxiliaryWindow();

		auxiliaryWindow.updateOptions({
			compact: true,
			lockCompact: true,
			nativeTitlebar: true,
			disableFullscreen: true,
		});
		auxiliaryWindow.updateOptions({ compact: false });

		expect(auxiliaryWindow.createState()).toMatchObject({
			compact: false,
			lockCompact: true,
			nativeTitlebar: true,
			disableFullscreen: true,
		});
	});

	// `EditorParts.restoreState()` feeds a persisted state object straight back
	// in as open options, so a trait only survives a restore if it makes the
	// full round trip out of one window, through JSON storage, and into the
	// next.
	it('round-trips its traits through serialized state into a restored window', () => {
		const original = createAuxiliaryWindow();
		original.updateOptions({
			compact: true,
			lockCompact: true,
			nativeTitlebar: true,
			disableFullscreen: true,
		});

		const restored = createAuxiliaryWindow();
		restored.updateOptions(JSON.parse(JSON.stringify(original.createState())));

		expect(restored.createState()).toMatchObject({
			compact: true,
			lockCompact: true,
			nativeTitlebar: true,
			disableFullscreen: true,
		});
	});

	// State persisted before the traits existed carries only `compact`; it must
	// restore exactly as it always has, with no trait invented for it.
	it('restores state persisted before chrome traits existed', () => {
		const restored = createAuxiliaryWindow();
		restored.updateOptions(JSON.parse('{ "compact": true }'));

		const state = restored.createState();
		expect(state.compact).toBe(true);
		expect(state.lockCompact).toBeUndefined();
		expect(state.nativeTitlebar).toBeUndefined();
		expect(state.disableFullscreen).toBeUndefined();
	});

	it('is unchanged by an updateOptions call with no options', () => {
		const auxiliaryWindow = createAuxiliaryWindow();
		auxiliaryWindow.updateOptions({ compact: true, nativeTitlebar: true });

		auxiliaryWindow.updateOptions(undefined);

		expect(auxiliaryWindow.createState()).toMatchObject({
			compact: true,
			nativeTitlebar: true,
		});
	});
});
