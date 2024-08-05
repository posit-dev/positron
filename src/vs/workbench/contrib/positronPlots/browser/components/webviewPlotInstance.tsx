/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { WebviewPlotClient } from 'vs/workbench/contrib/positronPlots/browser/webviewPlotClient';

/**
 * WebviewPlotInstanceProps interface.
 */
interface WebviewPlotInstanceProps {
	width: number;
	height: number;
	visible: boolean;
	plotClient: WebviewPlotClient;
}

/**
 * WebviewPlotInstance component. This component renders a webview as a plot in
 * the Plots pane.
 *
 * @param props A WebviewPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const WebviewPlotInstance = (props: WebviewPlotInstanceProps) => {
	const webviewRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		const client = props.plotClient;
		// Only claim if the plot is visible to avoid rendering the webview when
		// the parent view pane is collapsed.
		if (props.visible) {
			client.claim(this);
		}
		return () => {
			client.release(this);
		};
	}, [props.plotClient, props.visible]);

	useEffect(() => {
		if (webviewRef.current) {
			props.plotClient.layoutWebviewOverElement(webviewRef.current);
		}
	});

	const style = {
		width: `${props.width}px`,
		height: `${props.height}px`,
	};

	// The DOM we render is just a single div that the webview will be
	// positioned over.
	return (
		<div style={style} className='plot-instance' ref={webviewRef}>
		</div>
	);
};
