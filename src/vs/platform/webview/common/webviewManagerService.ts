/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

// --- Start Positron ---
import { VSBuffer } from '../../../base/common/buffer.js';
// --- End Positron ---

export const IWebviewManagerService = createDecorator<IWebviewManagerService>('webviewManagerService');

export interface WebviewWebContentsId {
	readonly webContentsId: number;
}

export interface WebviewWindowId {
	readonly windowId: number;
}

// --- Start Positron ---
/**
 * A unique composite identifier for a frame inside a webview.
 */
export interface WebviewFrameId {
	/** The process ID that backs the frame */
	readonly processId: number;

	/** The frame's routing identifier */
	readonly routingId: number;
}

/**
 * An event fired when a frame navigates to a new URL.
 */
export interface FrameNavigationEvent {
	/** The ID of the frame that navigated */
	readonly frameId: WebviewFrameId;

	/** The frame's new URL */
	readonly url: string;
}

export interface WebviewRectangle {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
// --- End Positron ---

export interface FindInFrameOptions {
	readonly forward?: boolean;
	readonly findNext?: boolean;
	readonly matchCase?: boolean;
}

export interface FoundInFrameResult {
	readonly requestId: number;
	readonly activeMatchOrdinal: number;
	readonly matches: number;
	readonly selectionArea: any;
	readonly finalUpdate: boolean;
}

export interface IWebviewManagerService {
	_serviceBrand: unknown;

	onFoundInFrame: Event<FoundInFrameResult>;

	setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void>;

	findInFrame(windowId: WebviewWindowId, frameName: string, text: string, options: FindInFrameOptions): Promise<void>;

	stopFindInFrame(windowId: WebviewWindowId, frameName: string, options: { keepSelection?: boolean }): Promise<void>;

	// --- Start Positron ---
	/**
	 * Waits for a frame with the given target URL to be created in a webview;
	 * when it has been created, returns the frame id.
	 *
	 * @param windowId The window id of the webview in which the frame is to be created.
	 * @param targetUrl The URL of the frame to wait for.
	 */
	awaitFrameCreation(windowId: WebviewWindowId, targetUrl: string): Promise<WebviewFrameId>;

	/**
	 * An event fired when a webview frame has navigated to a new URL.
	 */
	onFrameNavigation: Event<FrameNavigationEvent>;

	/**
	 * Capture a snapshot of the contents of a webview as a PNG image.
	 *
	 * @param windowId The window id of the webview to capture.
	 * @param area The area of the webview to capture, in CSS pixels.
	 */
	captureContentsAsPng(windowId: WebviewWindowId, area?: WebviewRectangle): Promise<VSBuffer | undefined>;

	/**
	 * Execute JavaScript code in a webview frame.
	 *
	 * @param frameId The ID of the frame in which to execute the code.
	 * @param code The code to execute.
	 *
	 * @returns A promise that resolves to the result of the code execution.
	 */
	executeJavaScript(frameId: WebviewFrameId, code: string): Promise<any>;
	// --- End Positron ---
}
