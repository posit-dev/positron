/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type { BrowserWindow } from 'electron';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAuxiliaryWindowsMainService } from '../../../auxiliaryWindow/electron-main/auxiliaryWindows.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { IDialogMainService } from '../../../dialogs/electron-main/dialogMainService.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { IGlobalKeybindingsMainService } from '../../../globalKeybindings/electron-main/globalKeybindingsMainService.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { IPositronStandaloneModeMainService } from '../../../positronStandaloneMode/common/positronStandaloneMode.js';
import { IProductService } from '../../../product/common/productService.js';
import { IRequestService } from '../../../request/common/request.js';
import { IThemeMainService } from '../../../theme/electron-main/themeMainService.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';
import { IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { IWorkspacesManagementMainService } from '../../../workspaces/electron-main/workspacesManagementMainService.js';
import { IProxyAuthService } from '../../electron-main/auth.js';
import { NativeHostMainService } from '../../electron-main/nativeHostMainService.js';

// The service and its imports touch electron at module load; none of the real
// objects can exist outside the main process. Only the pieces hideWindow and
// showWindow reach are functional: windows come from IWindowsMainService, so
// electron itself only needs inert event sources and a webContents lookup.
vi.mock('electron', () => {
	const nodeEventEmitter = () => ({ on: () => { }, removeListener: () => { } });
	return {
		default: {},
		app: nodeEventEmitter(),
		powerMonitor: nodeEventEmitter(),
		screen: nodeEventEmitter(),
		webContents: { fromId: () => undefined },
		BrowserWindow: {},
		Menu: {},
		Notification: class { },
		clipboard: {},
		contentTracing: {},
		powerSaveBlocker: {},
		shell: {},
		systemPreferences: {},
		nativeImage: {},
	};
});

/**
 * A code window whose fullscreen transition the test controls: `setFullScreen`
 * does not complete it; `leaveFullScreen()` fires the `leave-full-screen`
 * event a paused `hideWindow` awaits.
 */
function createCodeWindow(id: number, options?: { visible?: boolean; minimized?: boolean; fullScreen?: boolean }) {
	const listeners = new Map<string, Set<Function>>();
	let visible = options?.visible ?? true;
	let fullScreen = options?.fullScreen ?? false;
	const hide = vi.fn(() => { visible = false; });
	const show = vi.fn(() => { visible = true; });
	let win: BrowserWindow;
	// eslint-disable-next-line prefer-const
	win = stubInterface<BrowserWindow>({
		id,
		isVisible: () => visible,
		isMinimized: () => options?.minimized ?? false,
		isFullScreen: () => fullScreen,
		isDestroyed: () => false,
		setFullScreen: (value: boolean) => { fullScreen = value; },
		on: (event: string, listener: Function) => { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener); return win; },
		removeListener: (event: string, listener: Function) => { listeners.get(event)?.delete(listener); return win; },
		hide,
		show,
	});
	const window = stubInterface<ICodeWindow>({ id, win });
	return {
		window,
		hide,
		show,
		leaveFullScreen: () => listeners.get('leave-full-screen')?.forEach(listener => listener()),
	};
}

describe('NativeHostMainService hideWindow/showWindow', () => {
	const disposables = ensureNoLeakedDisposables();

	function build() {
		const claimChanges = disposables.add(new Emitter<void>());
		const windows = new Map<number, ICodeWindow>();
		const service = disposables.add(new NativeHostMainService(
			stubInterface<IWindowsMainService>({
				getWindowById: (id: number) => windows.get(id),
				onDidOpenWindow: Event.None,
				onDidTriggerSystemContextMenu: Event.None,
				onDidMaximizeWindow: Event.None,
				onDidUnmaximizeWindow: Event.None,
				onDidChangeFullScreen: Event.None,
				onDidChangeWindowsCount: Event.None,
			}),
			stubInterface<IAuxiliaryWindowsMainService>({
				onDidTriggerSystemContextMenu: Event.None,
				onDidMaximizeWindow: Event.None,
				onDidUnmaximizeWindow: Event.None,
				onDidChangeFullScreen: Event.None,
				onDidChangeAlwaysOnTop: Event.None,
			}),
			stubInterface<IDialogMainService>({}),
			stubInterface<ILifecycleMainService>({}),
			stubInterface<IEnvironmentMainService>({}),
			new NullLogService(),
			stubInterface<IProductService>({}),
			stubInterface<IThemeMainService>({ onDidChangeColorScheme: Event.None }),
			stubInterface<IWorkspacesManagementMainService>({}),
			stubInterface<IConfigurationService>({}),
			stubInterface<IRequestService>({}),
			stubInterface<IProxyAuthService>({}),
			stubInterface<IInstantiationService>({}),
			stubInterface<IGlobalKeybindingsMainService>({}),
			stubInterface<IPositronStandaloneModeMainService>({ onDidChange: claimChanges.event }),
		));
		return { service, windows, claimChanges };
	}

	it('hides a visible window once its fullscreen transition finishes', async () => {
		const { service, windows } = build();
		const { window, hide, leaveFullScreen } = createCodeWindow(1, { fullScreen: true });
		windows.set(1, window);

		const hiding = service.hideWindow(undefined, { targetWindowId: 1 });
		expect(hide).not.toHaveBeenCalled();
		leaveFullScreen();

		expect(await hiding).toBe(true);
		expect(hide).toHaveBeenCalledTimes(1);
	});

	it('reports false, leaving the window untouched, when it is hidden or minimized', async () => {
		const { service, windows } = build();
		const { window: hidden, hide: hideHidden } = createCodeWindow(1, { visible: false });
		const { window: minimized, hide: hideMinimized } = createCodeWindow(2, { minimized: true });
		windows.set(1, hidden).set(2, minimized);

		expect(await service.hideWindow(undefined, { targetWindowId: 1 })).toBe(false);
		expect(await service.hideWindow(undefined, { targetWindowId: 2 })).toBe(false);
		expect(hideHidden).not.toHaveBeenCalled();
		expect(hideMinimized).not.toHaveBeenCalled();
	});

	it('abandons a fullscreen hide when showWindow arrives during the transition', async () => {
		const { service, windows } = build();
		const { window, hide, leaveFullScreen } = createCodeWindow(1, { fullScreen: true });
		windows.set(1, window);

		const hiding = service.hideWindow(undefined, { targetWindowId: 1 });
		await service.showWindow(undefined, { targetWindowId: 1 });
		leaveFullScreen();

		expect(await hiding).toBe(false);
		expect(hide).not.toHaveBeenCalled();
	});

	it('abandons a fullscreen hide when the standalone claim changes during the transition', async () => {
		const { service, windows, claimChanges } = build();
		const { window, hide, leaveFullScreen } = createCodeWindow(1, { fullScreen: true });
		windows.set(1, window);

		const hiding = service.hideWindow(undefined, { targetWindowId: 1 });
		claimChanges.fire();
		leaveFullScreen();

		expect(await hiding).toBe(false);
		expect(hide).not.toHaveBeenCalled();
	});
});
