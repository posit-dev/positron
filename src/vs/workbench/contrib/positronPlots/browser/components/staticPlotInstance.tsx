/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PanZoomImage } from 'vs/workbench/contrib/positronPlots/browser/components/panZoomImage';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * StaticPlotInstanceProps interface.
 */
interface StaticPlotInstanceProps {
	plotClient: StaticPlotClient;
	zoom: ZoomLevel;
}

/**
 * StaticPlotInstance component. This component renders a single static (unchanging) plot
 * in the Plots pane.
 *
 * Unlike a DynamicPlotInstance, a StaticPlotInstance cannot redraw or resize itself. It renders
 * a static image at a fixed size.
 *
 * @param props A StaticPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const StaticPlotInstance = (props: StaticPlotInstanceProps) => {
	const ref = React.useRef<HTMLDivElement>(null);
	const [width, setWidth] = React.useState<number>(1);
	const [height, setHeight] = React.useState<number>(1);
	const resizeObserver = React.useRef<ResizeObserver>();

	React.useEffect(() => {
		resizeObserver.current = new ResizeObserver((entries: ResizeObserverEntry[]) => {
			if (entries.length > 0) {
				const entry = entries[0];
				const width = entry.contentRect.width;
				const height = entry.contentRect.height;
				setWidth(width);
				setHeight(height);
			}
		});
		if (ref.current) {
			resizeObserver.current.observe(ref.current);
		}
		return () => resizeObserver.current?.disconnect();

	}, []);

	return (
		<div className='plot-instance static-plot-instance' ref={ref}>
			<PanZoomImage
				imageUri={props.plotClient.uri}
				description={props.plotClient.code ? props.plotClient.code : 'Plot ' + props.plotClient.id}
				zoom={props.zoom}
				width={width}
				height={height}
			/>
		</div>);
};
