/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { PlotClientInstance, PlotClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * DynamicPlotInstanceProps interface.
 */
interface DynamicPlotInstanceProps {
	width: number;
	height: number;
	plotClient: PlotClientInstance;
}

/**
 * DynamicPlotInstance component. This component renders a single dynamic plot
 * in the Plots pane.
 *
 * Unlike a StaticPlotInstance, a DynamicPlotInstance can redraw itself when
 * the plot size changes. It wraps a PlotClientInstance, which is responsible
 * for generating the plot data.
 *
 * @param props A DynamicPlotInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const DynamicPlotInstance = (props: DynamicPlotInstanceProps) => {

	const [uri, setUri] = useState('');
	const progressRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		const ratio = window.devicePixelRatio;
		props.plotClient.render(props.height, props.width, ratio).then((result) => {
			setUri(result.uri);
		});

		let progressBar: ProgressBar | undefined;

		props.plotClient.onDidChangeState((state) => {
			if (progressRef.current) {
				if (state === PlotClientState.Rendering) {
					progressBar = new ProgressBar(progressRef.current);
					progressBar.infinite();
				} else if (state === PlotClientState.Rendered) {
					if (progressBar) {
						progressBar.stop();
						progressBar.dispose();
						progressBar = undefined;
					}
				}
			}
		});
	});

	const renderedImage = () => {
		return <div className='image-wrapper'>
			<img src={uri}
				alt={props.plotClient.metadata.code ?
					props.plotClient.metadata.code :
					'Plot ' + props.plotClient.id} />
		</div>;
	};

	const placeholderImage = () => {
		const style = {
			width: props.width + 'px',
			height: props.height + 'px'
		};
		return <div className='image-placeholder' style={style}>
			<div className='image-placeholder-text'>
				Rendering plot ({props.width} x {props.height})
			</div>
		</div>;
	};

	// If the plot is not yet rendered yet (no URI), show a placeholder;
	// otherwise, show the rendered plot.
	//
	// Consider: we probably want a more explicit loading state; as written we
	// will show the old URI until the new one is ready.
	return (
		<div className='plot-instance dynamic-plot-instance'>
			<div ref={progressRef}></div>
			{uri && renderedImage()}
			{!uri && placeholderImage()}
		</div>
	);
};
