/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';

/**
 * PreviewContainerProps interface.
 */
interface PreviewContainerProps {
	/** The preview loaded into the container, if any */
	preview?: PreviewWebview;

	/** Whether the preview (and the entire container pane) is visible */
	visible: boolean;

	/** Width of preview pane in px */
	width: number;

	/** Height of preview pane in px */
	height: number;

	/** X Position of preview pane in px */
	x: number;

	/** Y Position of preview pane in px */
	y: number;
}

/**
 * PreviewContainer component; holds the preview items.
 *
 * @param props A PreviewContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PreviewContainer = (props: PreviewContainerProps) => {

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
				webview.claim(this, undefined);
				if (webviewRef.current) {
					webview.layoutWebviewOverElement(webviewRef.current);
				}
				return () => {
					webview?.release(this);
				};
			} else {
				// If the preview is not visible, release the webview.
				webview.release(this);
			}
		}
		return () => { };
	}, [props.preview, props.visible, props.x, props.y]);

	// This `useEffect` intentionally runs on every render. It is responsible
	// for laying out the webview over the preview container; since the webview
	// is absolutely positioned over the container, it needs to be repositioned
	// every time the container is resized or moved.
	useEffect(() => {
		if (props.preview && webviewRef.current && props.visible) {
			props.preview.webview.layoutWebviewOverElement(webviewRef.current);
		}
	});

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	// The DOM we render is just a single div that the webview will be
	// positioned over.
	return (
		<div ref={webviewRef} style={style}>
		</div>
	);
};
