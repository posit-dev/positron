/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronWebviewDialog.css';

// React.
import { useLayoutEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalDialog } from '../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IOverlayWebview } from '../../../contrib/webview/browser/webview.js';

/**
 * Options for {@link showPositronWebviewDialog}.
 */
export interface IPositronWebviewDialogOptions {
	readonly title: string;
	readonly webview: IOverlayWebview;
	readonly width: number;
	readonly height: number;
	/**
	 * Called once when the dialog goes away, whether the user dismissed it or the
	 * caller closed it. Never called twice.
	 */
	readonly onClosed: () => void;
}

/**
 * Shows a Positron modal dialog whose content area is an overlay webview.
 *
 * The dialog chrome -- title bar, sizing, focus capture, Escape and the dimmed
 * backdrop -- is core's own `PositronModalDialog`, so it behaves like every other
 * Positron dialog. Only the body is a webview.
 *
 * Escape works while focus is on the chrome, but not while focus is inside the
 * webview: it is an iframe, so the keydown never reaches the dialog's handler.
 * Content that needs Escape has to observe it and ask to be closed.
 */
export function showPositronWebviewDialog(options: IPositronWebviewDialogOptions): IDisposable {
	const renderer = new PositronModalReactRenderer();

	let closed = false;
	const close = () => {
		if (closed) {
			return;
		}
		closed = true;
		// Release before disposing the renderer so the webview is not left
		// anchored to a detached element.
		options.webview.release(renderer);
		renderer.dispose();
		options.onClosed();
	};

	renderer.render(
		<PositronModalDialog
			height={options.height}
			renderer={renderer}
			title={options.title}
			width={options.width}
			onCancel={close}
		>
			<WebviewContent renderer={renderer} webview={options.webview} />
		</PositronModalDialog>
	);

	return { dispose: close };
}

interface WebviewContentProps {
	readonly renderer: PositronModalReactRenderer;
	readonly webview: IOverlayWebview;
}

/**
 * A single div that the overlay webview is positioned over.
 *
 * The same arrangement `webviewPlotInstance` uses for plots. `setAnchorElement`
 * walks up from the anchor to find the nearest explicit z-index and places the
 * webview one above it (`overlayLayoutElement.ts`), which is what lets an overlay
 * sit above the modal's backdrop rather than behind it.
 */
function WebviewContent({ renderer, webview }: WebviewContentProps) {
	const anchorRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) {
			return;
		}

		webview.claim(renderer, DOM.getWindow(anchor), undefined);

		// The dialog animates in, so the anchor has no useful dimensions on the
		// first layout pass. Re-anchor whenever it resizes, as the plots view does,
		// rather than measuring once.
		const resizeObserver = new ResizeObserver(entries => {
			for (const entry of entries) {
				if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
					webview.setAnchorElement(anchor);
				}
			}
		});
		resizeObserver.observe(anchor);

		return () => resizeObserver.disconnect();
	}, [renderer, webview]);

	return <div ref={anchorRef} className='positron-webview-dialog-content'></div>;
}
