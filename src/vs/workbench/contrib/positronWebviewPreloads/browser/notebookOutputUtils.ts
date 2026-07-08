/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export function buildWebviewHTML(opts: {
	content: string;
	script?: string;
}): string {

	let all: string = opts.content;

	all = `<style>${htmlOutputStyles}</style>` + all;

	if (opts.script) {
		all = `<script>${opts.script}</script>` + all;
	}

	return all;
}


// Styles that get added to the HTML content of the webview for things like cleaning
// up tables etc..
const htmlOutputStyles = `
table {
	width: 100%;
	border-collapse: collapse;
}
table, th, td {
	border: 1px solid #ddd;
}
th, td {
	padding: 8px;
	text-align: left;
}
tr:nth-child(even) {
	background-color: var(--vscode-textBlockQuote-background, #f2f2f2);
}
`;

type HTMLOutputMetricsMessage = {
	type: 'webviewMetrics';
	bodyScrollHeight: number;
	bodyScrollWidth: number;
};

type WheelForwardMessage = {
	type: 'wheelForward';
	deltaMode: number;
	deltaY: number;
};

type DoubleClickMessage = {
	type: 'doubleClick';
};

type HTMLOutputWebviewMessage = HTMLOutputMetricsMessage | WheelForwardMessage | DoubleClickMessage;


export function isHTMLOutputWebviewMessage(message: unknown): message is HTMLOutputMetricsMessage {
	return (message as HTMLOutputMetricsMessage | undefined)?.type === 'webviewMetrics';
}

export function isWheelForwardMessage(message: unknown): message is WheelForwardMessage {
	const m = message as Partial<WheelForwardMessage> | undefined;
	return m?.type === 'wheelForward'
		&& typeof m.deltaMode === 'number'
		&& typeof m.deltaY === 'number';
}

export function isDoubleClickMessage(message: unknown): message is DoubleClickMessage {
	return (message as DoubleClickMessage | undefined)?.type === 'doubleClick';
}

// Approximate line height used when a forwarded wheel event reports
// DOM_DELTA_LINE. Matches the divisor in StandardWheelEvent (the `/ 40` in its
// pixel-to-line conversion in base/browser/mouseEvent.ts), which is not
// exported. Keep this in sync if that constant moves.
const WHEEL_LINE_HEIGHT_PX = 40;

/**
 * Convert a forwarded wheel event's vertical delta into pixels so raw
 * DOM_DELTA_LINE / DOM_DELTA_PAGE values (e.g. Firefox) don't scroll by a
 * single pixel per tick. {@link pageHeight} is used to size a page-mode delta
 * (the height of the surface being scrolled).
 */
export function normalizeWheelDeltaY(deltaMode: number, deltaY: number, pageHeight: number): number {
	switch (deltaMode) {
		case WheelEvent.DOM_DELTA_LINE:
			return deltaY * WHEEL_LINE_HEIGHT_PX;
		case WheelEvent.DOM_DELTA_PAGE:
			return deltaY * pageHeight;
		default: // DOM_DELTA_PIXEL
			return deltaY;
	}
}


function webviewMessageCode() {
	// acquireVsCodeApi is a global injected by the webview host. Access it
	// through the window object so the production bundler cannot rename it.
	// eslint-disable-next-line no-restricted-globals
	const vscode: { postMessage: (message: HTMLOutputWebviewMessage) => void } =
		(window as any)['acquireVsCodeApi']();

	const getBodyScrollHeight = () => {
		const body = document.body;
		const documentElement = document.documentElement;
		return body.scrollHeight || documentElement.scrollHeight;
	};

	const getBodyScrollWidth = () => {
		const body = document.body;
		const documentElement = document.documentElement;
		return body.scrollWidth || documentElement.scrollWidth;
	};

	let lastHeight = -1;
	let lastWidth = -1;
	const sendSizeMessage = (force?: boolean) => {
		const height = getBodyScrollHeight();
		const width = getBodyScrollWidth();
		if (!force && height === lastHeight && width === lastWidth) {
			return;
		}
		lastHeight = height;
		lastWidth = width;
		vscode.postMessage({
			type: 'webviewMetrics',
			bodyScrollHeight: height,
			bodyScrollWidth: width
		});
	};

	const sendDoubleClickMessage = () => {
		vscode.postMessage({
			type: 'doubleClick'
		});
	};

	// Create resize observer to detect size changes
	const resizeObserver = new ResizeObserver(() => {
		sendSizeMessage();
	});

	try {
		const documentElement = document.documentElement;
		resizeObserver.observe(documentElement);
	} catch (e) {
		console.error('Error observing documentElement', e);
	}

	// ResizeObserver on documentElement only fires when the content box
	// changes, not when scrollHeight changes. Content mutations (e.g.
	// mermaid replacing a <pre> with a taller SVG) change scrollHeight
	// without affecting the viewport-constrained content box. A
	// MutationObserver catches these structural DOM changes.
	let sizeUpdateFrame: number | undefined;
	const debouncedSendSize = () => {
		if (sizeUpdateFrame !== undefined) {
			cancelAnimationFrame(sizeUpdateFrame);
		}
		sizeUpdateFrame = requestAnimationFrame(() => {
			sizeUpdateFrame = undefined;
			sendSizeMessage();
		});
	};

	const installBodyObserver = () => {
		const body = document.body;
		if (!body) {
			return;
		}
		const mutationObserver = new MutationObserver(debouncedSendSize);
		mutationObserver.observe(body, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true
		});
	};

	if (document.body) {
		installBodyObserver();
	} else {
		document.addEventListener('DOMContentLoaded', installBodyObserver);
	}

	// Let specialized webview contents forward double-click interactions to
	// the notebook cell that owns the webview.
	window.addEventListener('positronWebviewDoubleClick', sendDoubleClickMessage);

	// Two things can happen when the user wheels over a webview output:
	//
	// 1. Something inside the output can still scroll in the current
	//    direction: a pandas DataFrame with its own scrollbar, a tall
	//    raw HTML page where the body itself scrolls, etc. The browser
	//    handles those natively, so we stay out of the way -- otherwise
	//    the notebook around it lurches along with the content.
	//
	// 2. Nothing inside can consume more scroll in this direction.
	//    That covers outputs with nothing scrollable (a plotly plot, a
	//    static image) and outputs where an inner scroller has already
	//    reached its top/bottom edge. In both cases, wheeling should
	//    move the notebook, so we forward the event.
	//
	// The viewport has at most one element that scrolls on wheel. This
	// returns that element when viewport scrolling is enabled, or null
	// when the page disables it via overflow-y: hidden or clip. CSS
	// propagates body's overflow to the viewport when html is `visible`
	// (the default), so the effective overflow is html's unless that is
	// visible, in which case body's wins.
	const getViewportScrollConsumer = (): Element | null => {
		const root = document.documentElement;
		const body = document.body;
		const rootOverflow = window.getComputedStyle(root).overflowY;
		let effectiveOverflow = rootOverflow;
		if (rootOverflow === 'visible' && body) {
			effectiveOverflow = window.getComputedStyle(body).overflowY;
		}
		if (effectiveOverflow === 'hidden' || effectiveOverflow === 'clip') {
			return null;
		}
		return document.scrollingElement;
	};

	// findVerticalWheelConsumer walks up from the wheel target and
	// returns the first scrollable ancestor that still has room in the
	// wheel direction, or null when nothing can consume the scroll.
	const findVerticalWheelConsumer = (event: WheelEvent): Element | null => {
		const viewportConsumer = getViewportScrollConsumer();
		for (let node: Node | null = event.target as Node | null; node; node = node.parentNode) {
			// parentNode stops at a ShadowRoot; hop to its host so an
			// ancestor scroller outside the shadow tree is still reached.
			if (node instanceof ShadowRoot) {
				node = node.host;
			}
			if (!(node instanceof Element)) {
				return null;
			}
			const isBodyOrRoot = node === document.body || node === document.documentElement;
			if (isBodyOrRoot) {
				// Only the single viewport scroller implicitly scrolls on
				// wheel -- skip the other of body/documentElement, and
				// skip both when viewport scrolling is disabled.
				if (node !== viewportConsumer) {
					continue;
				}
			} else {
				const overflowY = window.getComputedStyle(node).overflowY;
				if (overflowY !== 'auto' && overflowY !== 'scroll') {
					continue;
				}
			}
			if (node.scrollHeight <= node.clientHeight) {
				continue;
			}
			if (event.deltaY < 0 && node.scrollTop > 0) {
				return node;
			}
			if (event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) {
				return node;
			}
		}
		return null;
	};

	// Trackpad momentum scrolling fires wheel events for a while after
	// the user's fingers leave the pad. When the inner scroller hits its
	// edge mid-gesture, the tail events would otherwise leak out and
	// jerk the notebook. Briefly keep routing to the element that last
	// consumed a wheel event: as long as the cursor is still inside that
	// element, suppress forwarding so momentum stays with that scroller
	// rather than the notebook around it. Moving the pointer elsewhere,
	// letting the grace window lapse, or starting a fresh gesture (a
	// direction reversal, a sudden jump in |deltaY|, or a gap between
	// events longer than momentum cadence -- tail events decay
	// monotonically and fire densely, so any of these signals a human
	// input) all lift the suppression.
	const MOMENTUM_GRACE_MS = 200;
	const NEW_GESTURE_DELTA_JUMP = 8;
	const GESTURE_GAP_MS = 50;
	let lastConsumer: Element | null = null;
	let lastConsumedAt = 0;
	let lastSeenDelta = 0;
	let lastEventAt = 0;
	window.addEventListener('wheel', (event: WheelEvent) => {
		if (event.defaultPrevented || event.deltaY === 0) {
			return;
		}
		const now = Date.now();
		const gapSincePrev = now - lastEventAt;
		lastEventAt = now;
		const consumer = findVerticalWheelConsumer(event);
		if (consumer) {
			lastConsumer = consumer;
			lastConsumedAt = now;
			lastSeenDelta = event.deltaY;
			return;
		}
		if (lastConsumer
			&& event.target instanceof Node
			&& lastConsumer.contains(event.target)
			&& now - lastConsumedAt < MOMENTUM_GRACE_MS) {
			const sameDirection = Math.sign(event.deltaY) === Math.sign(lastSeenDelta);
			const jumped = Math.abs(event.deltaY) > Math.abs(lastSeenDelta) + NEW_GESTURE_DELTA_JUMP;
			const gappedOut = gapSincePrev > GESTURE_GAP_MS;
			if (sameDirection && !jumped && !gappedOut) {
				lastSeenDelta = event.deltaY;
				return;
			}
			lastConsumer = null;
		}
		vscode.postMessage({
			type: 'wheelForward',
			deltaMode: event.deltaMode,
			deltaY: event.deltaY,
		});
	}, { passive: true });

	// Send message on load back to Positron. Force bypasses the dedup
	// guard so the host always receives the initial size even if an
	// observer already posted the same dimensions before onMessage was
	// attached.
	window.onload = () => sendSizeMessage(true);
}

export const webviewMessageCodeString = `(${webviewMessageCode.toString()})();`;
