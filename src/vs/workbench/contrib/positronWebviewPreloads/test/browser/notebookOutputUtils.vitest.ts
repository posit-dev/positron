/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { webviewMessageCodeString } from '../../browser/notebookOutputUtils.js';

const WINDOWS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/**
 * Runs the script that is injected into webview outputs, as a webview on the given platform would,
 * and returns the deltas of the wheel events it forwards to the notebook.
 */
function runWebviewScript(userAgent: string): number[] {
	const forwarded: number[] = [];
	const postMessage = (message: { type: string; deltaY?: number }) => {
		if (message.type === 'wheelForward' && message.deltaY !== undefined) {
			forwarded.push(message.deltaY);
		}
	};
	// The script reads the user agent only while it starts. Restore the real getter right away, so
	// the next call in the same beforeAll can install its own platform.
	const userAgentSpy = vi.spyOn(mainWindow.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
	Object.assign(mainWindow, { acquireVsCodeApi: () => ({ postMessage }) });
	try {
		// Run the exact string that ships, not the function it is built from.
		new Function(webviewMessageCodeString)();
	} finally {
		userAgentSpy.mockRestore();
	}
	return forwarded;
}

/**
 * Wheels over the webview's body, where nothing can scroll, so a forwarded event moves the notebook.
 */
function wheel(init: WheelEventInit) {
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
	// happy-dom's WheelEvent extends UIEvent rather than MouseEvent, so it drops the modifier keys.
	Object.defineProperty(event, 'shiftKey', { value: init.shiftKey ?? false });
	mainWindow.document.body.dispatchEvent(event);
}

describe('webview output wheel forwarding', () => {
	// The script adds window listeners that cannot be removed, so run it once per platform and
	// let each test read only the events it sends.
	let windows: number[] = [];
	let mac: number[] = [];
	beforeAll(() => {
		windows = runWebviewScript(WINDOWS_USER_AGENT);
		mac = runWebviewScript(MAC_USER_AGENT);
	});
	beforeEach(() => {
		windows.length = 0;
		mac.length = 0;
	});
	afterAll(() => {
		Reflect.deleteProperty(mainWindow, 'acquireVsCodeApi');
	});

	test('forwards a vertical wheel to the notebook', () => {
		wheel({ deltaY: 100 });

		expect({ windows, mac }).toEqual({ windows: [100], mac: [100] });
	});

	test('does not forward shift + vertical wheel on Windows and Linux, where it scrolls horizontally (#11063)', () => {
		wheel({ deltaY: 100, shiftKey: true });
		wheel({ deltaY: -100, shiftKey: true });

		// macOS converts shift + wheel to delta X before the event arrives, so an event with delta Y
		// and the shift key set is a vertical scroll there.
		expect({ windows, mac }).toEqual({ windows: [], mac: [100, -100] });
	});
});
