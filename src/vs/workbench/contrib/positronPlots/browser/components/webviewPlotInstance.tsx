/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
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
	plotClient: WebviewPlotClient;
	visible: boolean;
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
		client.claim(this);
		return () => {
			client.release(this);
		};
	}, [props.plotClient]);

	useEffect(() => {
		if (webviewRef.current) {
			props.plotClient.layoutWebviewOverElement(webviewRef.current);
		}
	}, [props.plotClient, props.width, props.height, props.visible]);

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
