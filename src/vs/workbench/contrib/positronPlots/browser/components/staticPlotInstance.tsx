/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PanZoomImage } from './panZoomImage.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';

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
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number>(1);
	const [height, setHeight] = useState<number>(1);
	const resizeObserver = useRef<ResizeObserver>(null!);
	const plotName = props.plotClient.metadata.name ? props.plotClient.metadata.name : 'Plot ' + props.plotClient.id;

	useEffect(() => {
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
		<div ref={ref} className='plot-instance static-plot-instance'>
			<PanZoomImage
				description={plotName}
				height={height}
				imageUri={props.plotClient.uri}
				width={width}
				zoom={props.zoom}
			/>
		</div>);
};
