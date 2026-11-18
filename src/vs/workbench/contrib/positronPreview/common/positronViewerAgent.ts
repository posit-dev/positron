/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * What's showing in the Viewer.
 * - `url`: a web page or app loaded from a URL (Shiny, Streamlit, Dash, ...).
 * - `html`: an HTML file or string (htmlwidgets, local HTML files, Quarto
 *   output opened in the Viewer).
 * - `output`: output drawn by a notebook renderer, from a console session or a
 *   Quarto chunk (Plotly charts, HTML with scripts). It has no address.
 * - `other`: something agents can't read, such as a preview an extension made.
 * - `none`: the Viewer is empty.
 */
export type ViewerContentKind = 'url' | 'html' | 'output' | 'other' | 'none';

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
	/** What shows the content: a webview, or the integrated browser, which keeps the page's console logs. */
	readonly backend?: 'webview' | 'browser';
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
 * An element to act on: a ref from a snapshot, such as `e3`, or a CSS
 * selector that matches exactly one element.
 */
export interface IViewerTarget {
	readonly ref?: string;
	readonly selector?: string;
}

/**
 * A point for a drag: an element's center, or with `dx` and `dy`, that far
 * from its top left corner, in CSS pixels. Without an element, the point is
 * on the element the drag started from.
 */
export interface IViewerDragPoint extends IViewerTarget {
	readonly dx?: number;
	readonly dy?: number;
}

/** A file to attach to a file input, with its bytes in base64. */
export interface IViewerFile {
	readonly name: string;
	readonly type: string;
	readonly data: string;
}

/**
 * How to answer the dialogs (`alert`, `confirm`, `prompt`) a page shows
 * during an agent's actions.
 */
export interface IViewerDialogPolicy {
	readonly accept: boolean;
	/** The text to answer a prompt with. */
	readonly promptText?: string;
}

/** A dialog a page showed during an action. */
export interface IViewerDialog {
	readonly type: 'alert' | 'confirm' | 'prompt';
	readonly message: string;
}

/**
 * An action for an agent to take on the page in the Viewer, on a target
 * (see `IViewerTarget`).
 * - `click` and `hover`: send the pointer and mouse events a user would.
 *   `click` can double-click, and use the right or middle button.
 * - `fill`: type into a text or number box or an editable area, or move a
 *   slider, to `value`. Dropdowns are handed on to `select`. With `submit`,
 *   then press Enter.
 * - `select`: pick options in a dropdown, by their text or value. In one where
 *   several can be picked, the values given replace what was picked; elsewhere,
 *   give one value. To pick an option in a list of options (radio items,
 *   checklists), click the option.
 * - `press`: press a key (`Enter`, `Escape`, `ArrowDown`, ...) or a
 *   combination (`Control+a`, `Shift+Tab`) in a control, or in whatever has
 *   focus.
 * - `type`: type text one key at a time, into a control or whatever has focus.
 * - `drag`: drag from one point to another (see `IViewerDragPoint`).
 * - `upload`: attach files to a file input, or drop them on a drop zone.
 *   Agents give `paths`; Positron reads them into `files` for the bridge.
 * - `scroll`: bring a control into view, or scroll by `dx` and `dy` pixels
 *   (the control's scrolling area, or the page's).
 * - `wait`: wait for the app to settle, or for some text to show up.
 * - `navigate`: go to a URL, back, forward, or reload. Positron does this
 *   itself, not the bridge.
 * - `handleDialog`: set how dialogs are answered during the actions that
 *   follow. Positron keeps this, not the bridge.
 */
export type ViewerAction =
	| { readonly kind: 'click'; readonly ref?: string; readonly selector?: string; readonly dblClick?: boolean; readonly button?: 'left' | 'right' | 'middle' }
	| { readonly kind: 'hover'; readonly ref?: string; readonly selector?: string }
	| { readonly kind: 'fill'; readonly ref?: string; readonly selector?: string; readonly value: string; readonly submit?: boolean }
	| { readonly kind: 'select'; readonly ref?: string; readonly selector?: string; readonly value: string | readonly string[] }
	| { readonly kind: 'press'; readonly key: string; readonly ref?: string; readonly selector?: string }
	| { readonly kind: 'type'; readonly text: string; readonly ref?: string; readonly selector?: string; readonly submit?: boolean }
	| { readonly kind: 'drag'; readonly from: IViewerDragPoint; readonly to: IViewerDragPoint }
	| { readonly kind: 'upload'; readonly ref?: string; readonly selector?: string; readonly paths?: readonly string[]; readonly files?: readonly IViewerFile[] }
	| { readonly kind: 'scroll'; readonly ref?: string; readonly selector?: string; readonly dx?: number; readonly dy?: number }
	| { readonly kind: 'wait'; readonly for: 'idle' | 'text'; readonly text?: string; readonly timeoutMs?: number }
	| { readonly kind: 'navigate'; readonly type: 'url' | 'back' | 'forward' | 'reload'; readonly url?: string }
	| { readonly kind: 'handleDialog'; readonly accept: boolean; readonly promptText?: string };

/** A rectangle in the page's viewport, in CSS pixels. */
export interface IViewerRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Where an element is on screen, for input sent from outside the page. */
export interface IViewerLocation extends IViewerRect {
	/** How to refer to the element in messages, such as `button "Go"`. */
	readonly description: string;
	/** Whether a checkbox, switch or radio button is checked. */
	readonly checked?: boolean;
	/** Whether a pointer at the element's center reaches it, rather than something covering it. */
	readonly pointable: boolean;
	/** Whether dragging the element starts HTML drag and drop. */
	readonly draggable: boolean;
}

/** Options for a screenshot of the Viewer. */
export interface IViewerScreenshotOptions extends IViewerTarget {
	/** With a target, scroll it into view first. */
	readonly scrollIntoView?: boolean;
	/** Capture the whole page rather than what's on screen (the integrated browser only). */
	readonly fullPage?: boolean;
}

/** Options for finding an element. */
export interface IViewerLocateOptions {
	/** Throw if the element is disabled or hidden. */
	readonly usable?: boolean;
	readonly scrollIntoView?: boolean;
	readonly focus?: boolean;
}

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
	/** Finds an element and where it is in the viewport. */
	locate(target: IViewerTarget, options?: IViewerLocateOptions): IViewerLocation;
	/**
	 * With a policy, answers the page's dialogs by it from now on, rather than
	 * showing them; with null, shows them again. Returns the dialogs answered
	 * since the last call.
	 */
	dialogs(policy: IViewerDialogPolicy | null): IViewerDialog[];
	/** Evaluates a JavaScript expression in the page, and returns its value as JSON. */
	evaluate(expression: string): Promise<string>;
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
	getViewerScreenshot(options?: IViewerScreenshotOptions): Promise<IViewerScreenshot>;

	/**
	 * Takes an action on the page in the Viewer, waits for the app to settle,
	 * and returns a fresh snapshot. Reveals the Viewer first if it's hidden, and
	 * leaves keyboard focus where the user had it. Rejects with a message the
	 * agent can act on when the action can't be taken or doesn't take effect.
	 *
	 * @param snapshotOptions Options for the snapshot taken afterwards.
	 */
	viewerAct(action: ViewerAction, snapshotOptions?: IViewerSnapshotOptions): Promise<IViewerActResult>;

	/**
	 * Gets the console messages of the page in the Viewer. Rejects when the
	 * Viewer doesn't use the integrated browser, which keeps them.
	 */
	getViewerConsoleLogs(): Promise<string>;

	/**
	 * Evaluates a JavaScript expression in the page in the Viewer, and returns
	 * its value as JSON.
	 */
	viewerEvaluate(expression: string, timeoutMs?: number): Promise<string>;
}
