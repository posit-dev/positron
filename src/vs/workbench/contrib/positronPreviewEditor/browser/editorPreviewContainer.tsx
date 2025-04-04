/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from '../../../../../vs/base/browser/dom.js';
import { useEffect, useLayoutEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { PreviewWebview } from '../../../../../vs/workbench/contrib/positronPreview/browser/previewWebview.js';

interface EditorPreviewContainerProps {
	/** The preview loaded into the container, if any */
	preview?: PreviewWebview;
	height: number;
	width: number;
	visible: boolean;
}

export const EditorPreviewContainer = (props: EditorPreviewContainerProps) => {
	const webviewRef = React.useRef<HTMLDivElement>(null);
	// This `useEffect` fires when the preview item changes or visibility of the
	// pane itself changes. It is responsible for claiming and releasing the
	// webview.
	useEffect(() => {
		if (!props.preview || !props.visible || !webviewRef.current) {
			return;
		}

		const webview = props.preview.webview;
		const window = DOM.getWindow(webviewRef.current);
		webview.webview.claim(this, window, undefined);
		// actually moving preview to webview
		webview.webview.layoutWebviewOverElement(webviewRef.current);

		return () => {
			webview?.webview.release(this);
		};

	}, [props.preview, props.visible]);

	// This `useEffect` intentionally runs on every render. It is responsible
	// for laying out the webview over the preview container; since the webview
	// is absolutely positioned over the container, it needs to be repositioned
	// every time the container is resized or moved.
	useLayoutEffect(() => {
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
		<div ref={webviewRef} className='preview-container' style={style}>
		</div>
	);
};
