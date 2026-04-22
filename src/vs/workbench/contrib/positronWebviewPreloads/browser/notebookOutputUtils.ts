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

type HTMLOutputWebviewMessage = HTMLOutputMetricsMessage | WheelForwardMessage;


export function isHTMLOutputWebviewMessage(message: unknown): message is HTMLOutputMetricsMessage {
	return (message as HTMLOutputMetricsMessage | undefined)?.type === 'webviewMetrics';
}

export function isWheelForwardMessage(message: unknown): message is WheelForwardMessage {
	const m = message as Partial<WheelForwardMessage> | undefined;
	return m?.type === 'wheelForward'
		&& typeof m.deltaMode === 'number'
		&& typeof m.deltaY === 'number';
}

// Helper function for TypeScript typing
function acquireVsCodeApi(): { postMessage: (message: HTMLOutputWebviewMessage) => void } {
	throw new Error('Function not implemented.');
}

function webviewMessageCode() {
	const vscode = acquireVsCodeApi();

	const sendSizeMessage = () => {
		// Get body of the webview and measure content sizes
		// eslint-disable-next-line no-restricted-syntax
		const body = document.body;
		// eslint-disable-next-line no-restricted-syntax
		const documentElement = document.documentElement;
		const bodyScrollHeight = body.scrollHeight || documentElement.scrollHeight;
		const bodyScrollWidth = body.scrollWidth || documentElement.scrollWidth;

		vscode.postMessage({
			type: 'webviewMetrics',
			bodyScrollHeight,
			bodyScrollWidth
		});
	};

	// Create resize observer to detect size changes
	const resizeObserver = new ResizeObserver(() => {
		sendSizeMessage();
	});

	try {
		// eslint-disable-next-line no-restricted-syntax
		const documentElement = document.documentElement;
		resizeObserver.observe(documentElement);
	} catch (e) {
		console.error('Error observing documentElement', e);
	}

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
		// eslint-disable-next-line no-restricted-syntax
		const root = document.documentElement;
		// eslint-disable-next-line no-restricted-syntax
		const body = document.body;
		// eslint-disable-next-line no-restricted-globals
		const rootOverflow = window.getComputedStyle(root).overflowY;
		let effectiveOverflow = rootOverflow;
		if (rootOverflow === 'visible' && body) {
			// eslint-disable-next-line no-restricted-globals
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
			// eslint-disable-next-line no-restricted-syntax
			const isBodyOrRoot = node === document.body || node === document.documentElement;
			if (isBodyOrRoot) {
				// Only the single viewport scroller implicitly scrolls on
				// wheel -- skip the other of body/documentElement, and
				// skip both when viewport scrolling is disabled.
				if (node !== viewportConsumer) {
					continue;
				}
			} else {
				// eslint-disable-next-line no-restricted-globals
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
	// direction reversal or a sudden jump in |deltaY|, since tail events
	// decay monotonically) all lift the suppression.
	const MOMENTUM_GRACE_MS = 200;
	const NEW_GESTURE_DELTA_JUMP = 8;
	let lastConsumer: Element | null = null;
	let lastConsumedAt = 0;
	let lastSeenDelta = 0;
	// eslint-disable-next-line no-restricted-globals
	window.addEventListener('wheel', (event: WheelEvent) => {
		if (event.defaultPrevented || event.deltaY === 0) {
			return;
		}
		const consumer = findVerticalWheelConsumer(event);
		if (consumer) {
			lastConsumer = consumer;
			lastConsumedAt = Date.now();
			lastSeenDelta = event.deltaY;
			return;
		}
		if (lastConsumer
			&& event.target instanceof Node
			&& lastConsumer.contains(event.target)
			&& Date.now() - lastConsumedAt < MOMENTUM_GRACE_MS) {
			const sameDirection = Math.sign(event.deltaY) === Math.sign(lastSeenDelta);
			const jumped = Math.abs(event.deltaY) > Math.abs(lastSeenDelta) + NEW_GESTURE_DELTA_JUMP;
			if (sameDirection && !jumped) {
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

	// Send message on load back to Positron
	// eslint-disable-next-line no-restricted-globals
	window.onload = sendSizeMessage;
}

export const webviewMessageCodeString = `(${webviewMessageCode.toString()})();`;
