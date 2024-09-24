/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from '../../../../../vs/base/browser/dom';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { PreviewWebview } from '../../../../../vs/workbench/contrib/positronPreview/browser/previewWebview';

interface EditorPreviewContainerProps {
	/** The preview loaded into the container, if any */
	preview?: PreviewWebview;
	/** Whether the preview (and the entire container pane) is visible */
	visible: boolean;
	height: number;
	width: number;
}

export const EditorPreviewContainer = (props: EditorPreviewContainerProps) => {
	const webviewRef = React.useRef<HTMLDivElement>(null);
	// This `useEffect` fires when the preview item changes or visibility of the
	// pane itself changes. It is responsible for claiming and releasing the
	// webview.
	useEffect(() => {
		if (props.preview) {
			// If a preview is loaded into the pane, let it know its
			// visibility status.
			const webview = props.preview.webview;
			props.preview.visible = props.visible;

			// If the preview is visible, claim the webview and release it when
			// we're unmounted.
			if (props.visible) {
				if (webviewRef.current) {
					const window = DOM.getWindow(webviewRef.current);
					webview.webview.claim(this, window, undefined);
					webview.webview.layoutWebviewOverElement(webviewRef.current);
					return () => {
						webview?.webview.release(this);
					};
				}
			} else {
				// If the preview is not visible, release the webview.
				webview.webview.release(this);
			}
		}
		return () => { };
	}, [props.preview, props.visible]);

	// This `useEffect` intentionally runs on every render. It is responsible
	// for laying out the webview over the preview container; since the webview
	// is absolutely positioned over the container, it needs to be repositioned
	// every time the container is resized or moved.
	useEffect(() => {
		if (props.preview && webviewRef.current && props.visible) {
			props.preview.webview.webview.layoutWebviewOverElement(webviewRef.current);
		}
	});

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	// The DOM we render is just a single div that the webview will be
	// positioned over.
	return (
		<div className='preview-container' ref={webviewRef} style={style}>
		</div>
	);
};
