/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
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
	// preview's surface.
	useEffect(() => {
		if (!props.preview || !props.visible || !webviewRef.current) {
			return;
		}

		const surface = props.preview.surface;
		surface.claim(this, webviewRef.current);

		return () => {
			surface.release(this);
		};

	}, [props.preview, props.visible]);

	// This `useEffect` intentionally runs on every render. It is responsible
	// for laying out the surface over the preview container; since the surface
	// is absolutely positioned over the container, it needs to be repositioned
	// every time the container is resized or moved.
	useLayoutEffect(() => {
		if (props.preview && webviewRef.current && props.visible) {
			props.preview.surface.layout();
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
