/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewService';

/**
 * PreviewContainerProps interface.
 */
interface PreviewContainerProps {
	preview?: PreviewWebview;
	visible: boolean;
	width: number;
	height: number;
}

/**
 * PreviewContainer component; holds the preview items.
 *
 * @param props A PreviewContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PreviewContainer = (props: PreviewContainerProps) => {

	const webviewRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (props.preview) {
			const webview = props.preview.webview;
			if (props.visible) {
				webview.claim(this, undefined);
				return () => {
					webview?.release(this);
				};
			} else {
				webview.release(this);
			}
		}
		return () => { };
	}, [props.preview, props.visible]);

	useEffect(() => {
		if (props.preview && webviewRef.current && props.visible) {
			props.preview.webview.layoutWebviewOverElement(webviewRef.current);
		}
	});

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	return (
		<div ref={webviewRef} style={style}>
		</div>
	);
};
