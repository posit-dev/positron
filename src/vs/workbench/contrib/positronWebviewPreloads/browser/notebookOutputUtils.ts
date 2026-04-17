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
	// 1. The output contains a scrollable element (e.g. a big pandas
	//    DataFrame rendered with its own scrollbar, or a tall raw HTML
	//    page where the body itself scrolls). The browser scrolls that
	//    element on its own -- we don't want to also scroll the notebook
	//    around it, or the whole page lurches with the content.
	//
	// 2. The output has nothing scrollable inside (e.g. a plotly plot,
	//    a static image). Wheeling does nothing unless we forward the
	//    event out to the notebook container.
	//
	// So we walk up from the wheel target: if we find an ancestor that
	// can still scroll in this direction, the browser will handle it and
	// we stay quiet. Otherwise we forward the event to the host.
	const canConsumeVerticalWheel = (event: WheelEvent): boolean => {
		for (let node: Node | null = event.target as Node | null; node; node = node.parentNode) {
			if (!(node instanceof Element)) {
				return false;
			}
			// eslint-disable-next-line no-restricted-syntax
			const isBodyOrRoot = node === document.body || node === document.documentElement;
			// eslint-disable-next-line no-restricted-globals
			const overflowY = window.getComputedStyle(node).overflowY;
			// Body and documentElement scroll implicitly when content overflows
			// the viewport even without an explicit overflow-y style.
			if (!isBodyOrRoot && overflowY !== 'auto' && overflowY !== 'scroll') {
				continue;
			}
			if (node.scrollHeight <= node.clientHeight) {
				continue;
			}
			if (event.deltaY < 0 && node.scrollTop > 0) {
				return true;
			}
			if (event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) {
				return true;
			}
		}
		return false;
	};

	// Trackpad momentum scrolling fires wheel events for a while after the
	// user's fingers leave the pad. When an inner scroller hits its edge
	// mid-gesture, the tail events would otherwise leak out and jerk the
	// notebook. Suppress forwarding briefly after an inner consumer handled
	// a wheel event so those tail events stay inside the output.
	const MOMENTUM_GRACE_MS = 200;
	let lastConsumedAt = 0;
	// eslint-disable-next-line no-restricted-globals
	window.addEventListener('wheel', (event: WheelEvent) => {
		if (event.defaultPrevented || event.deltaY === 0) {
			return;
		}
		if (canConsumeVerticalWheel(event)) {
			lastConsumedAt = Date.now();
			return;
		}
		if (Date.now() - lastConsumedAt < MOMENTUM_GRACE_MS) {
			return;
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
