/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * What's showing in the Viewer.
 * - `url`: a web page or app loaded from a URL (Shiny, Streamlit, Dash, ...).
 * - `html`: an HTML file or string (htmlwidgets, local HTML files).
 * - `other`: something agents can't read yet, such as notebook renderer output.
 * - `none`: the Viewer is empty.
 */
export type ViewerContentKind = 'url' | 'html' | 'other' | 'none';

/**
 * Describes what's showing in the Viewer.
 */
export interface IViewerInfo {
	readonly kind: ViewerContentKind;
	/** The title of the Viewer's content, when known. */
	readonly title?: string;
	/** The address of the page showing in the Viewer now. In web builds it may be a proxied URL. */
	readonly url?: string;
	/** The ID of the runtime session that opened the content, when known. */
	readonly sourceSessionId?: string;
	/** Whether the Viewer is showing on screen. */
	readonly visible: boolean;
}

/**
 * Options for a snapshot of the Viewer's content.
 */
export interface IViewerSnapshotOptions {
	/** Only list the controls an agent can interact with. */
	readonly interactiveOnly?: boolean;
	/** A CSS selector limiting the snapshot to part of the page. */
	readonly selector?: string;
	/** The maximum length of the snapshot text, in characters. */
	readonly maxChars?: number;
}

/**
 * A text snapshot of the Viewer's content: an outline of the page with element
 * roles, names and key properties, and refs for the controls.
 */
export interface IViewerSnapshot {
	/** The outline. It comes from the page, which can make it say anything. */
	readonly text: string;
	/** The page's address, from Positron rather than the page, so the page can't fake it. */
	readonly url: string;
	/** The page's title. */
	readonly title: string;
	/** Whether the outline was cut short to fit `maxChars`. */
	readonly truncated: boolean;
}

/**
 * A snapshot as the bridge takes it, without the page's address, which
 * Positron adds.
 */
export type ViewerBridgeSnapshot = Omit<IViewerSnapshot, 'url'>;

/**
 * A screenshot of the Viewer's content.
 */
export interface IViewerScreenshot {
	readonly mimeType: 'image/png';
	readonly data: VSBuffer;
	readonly width: number;
	readonly height: number;
	/**
	 * How the image was made: `native` is a real capture of the screen;
	 * `dom` is rebuilt from the page's content (web builds), which can miss
	 * WebGL content and images from other hosts.
	 */
	readonly method: 'native' | 'dom';
	/** Whether the Viewer had to be revealed to take the screenshot. */
	readonly revealed: boolean;
}

/**
 * Options for waiting until the app in the Viewer has settled.
 */
export interface IViewerIdleOptions {
	/** How long the page must go without DOM changes, in milliseconds. */
	readonly quietMs?: number;
	/** The longest to wait, in milliseconds. */
	readonly timeoutMs?: number;
}

/**
 * The result of waiting for the app in the Viewer to settle.
 */
export interface IViewerIdleResult {
	readonly waitedMs: number;
	readonly timedOut: boolean;
}

/**
 * The size of the app's viewport, in CSS pixels.
 */
export interface IViewerViewport {
	readonly width: number;
	readonly height: number;
}

/**
 * An action for an agent to take on the page in the Viewer. `ref` is a
 * control's ref from a snapshot, such as `e3`.
 * - `click` and `hover`: send the pointer and mouse events a user would.
 * - `fill`: type into a text or number box, or move a slider, to `value`.
 *   Dropdowns are handed on to `select`.
 * - `select`: pick options in a dropdown, by their text or value. In one where
 *   several can be picked, the values given replace what was picked; elsewhere,
 *   give one value. To pick an option in a list of options (radio items,
 *   checklists), click the option.
 * - `press`: press a key (`Enter`, `Escape`, `ArrowDown`, ...) in a control,
 *   or in whatever has focus.
 * - `scroll`: bring a control into view, or scroll by `dx` and `dy` pixels
 *   (the control's scrolling area, or the page's).
 * - `wait`: wait for the app to settle, or for some text to show up.
 */
export type ViewerAction =
	| { readonly kind: 'click'; readonly ref: string }
	| { readonly kind: 'hover'; readonly ref: string }
	| { readonly kind: 'fill'; readonly ref: string; readonly value: string }
	| { readonly kind: 'select'; readonly ref: string; readonly value: string | readonly string[] }
	| { readonly kind: 'press'; readonly key: string; readonly ref?: string }
	| { readonly kind: 'scroll'; readonly ref?: string; readonly dx?: number; readonly dy?: number }
	| { readonly kind: 'wait'; readonly for: 'idle' | 'text'; readonly text?: string; readonly timeoutMs?: number };

/**
 * What an action did, as the bridge reports it.
 */
export interface IViewerActOutcome {
	/**
	 * What the action did, for the agent. The bridge works it out from the
	 * page, which can mislead it.
	 */
	readonly message: string;
	/** Whether the page went to another document, for example by following a link. */
	readonly navigated: boolean;
	/** Whether the app was still busy when the wait for it to settle ran out. */
	readonly timedOut: boolean;
}

/**
 * The result of an action on the page in the Viewer.
 */
export interface IViewerActResult {
	/** What the action did, for the agent. */
	readonly message: string;
	/**
	 * A snapshot of the page once the app has settled after the action, unless
	 * one couldn't be taken; the message then says why.
	 */
	readonly snapshot?: IViewerSnapshot;
	/** Whether the app was still busy when the wait for it to settle ran out. */
	readonly timedOut: boolean;
	/** Whether the Viewer had to be revealed to act on it. */
	readonly revealed: boolean;
}

/**
 * The bridge that runs against the app's window in the Viewer. See
 * `createViewerBridge`. Every argument and result is plain data, so calls can
 * cross into the app's frame on Desktop.
 */
export interface IViewerBridge {
	snapshot(options?: IViewerSnapshotOptions): ViewerBridgeSnapshot;
	waitForIdle(options?: IViewerIdleOptions): Promise<IViewerIdleResult>;
	viewport(): IViewerViewport;
	/** Takes an action, then waits for the app to settle (`idle`) and checks the action took. */
	act(action: ViewerAction, idle?: IViewerIdleOptions): Promise<IViewerActOutcome>;
}

export const IPositronViewerAgentService = createDecorator<IPositronViewerAgentService>('positronViewerAgentService');

/**
 * Lets AI agents read and act on the content of the Viewer pane: what's
 * showing, a text snapshot of the page, a screenshot, and actions a user
 * could take.
 */
export interface IPositronViewerAgentService {
	readonly _serviceBrand: undefined;

	/**
	 * Describes what's showing in the Viewer.
	 */
	getViewerInfo(): Promise<IViewerInfo>;

	/**
	 * Takes a text snapshot of the page in the Viewer, once the app has
	 * settled. Rejects with a message the agent can act on when there's nothing
	 * to snapshot.
	 */
	getViewerSnapshot(options?: IViewerSnapshotOptions): Promise<IViewerSnapshot>;

	/**
	 * Takes a screenshot of what's on screen in the Viewer. Reveals the
	 * Viewer first if it's hidden, without taking focus.
	 */
	getViewerScreenshot(): Promise<IViewerScreenshot>;

	/**
	 * Takes an action on the page in the Viewer, waits for the app to settle,
	 * and returns a fresh snapshot. Reveals the Viewer first if it's hidden, and
	 * leaves keyboard focus where the user had it. Rejects with a message the
	 * agent can act on when the action can't be taken or doesn't take effect.
	 *
	 * @param snapshotOptions Options for the snapshot taken afterwards.
	 */
	viewerAct(action: ViewerAction, snapshotOptions?: IViewerSnapshotOptions): Promise<IViewerActResult>;
}
