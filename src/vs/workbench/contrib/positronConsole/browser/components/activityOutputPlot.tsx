/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityOutputPlot.css';

// React.
import React from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import { usePositronConfiguration } from '../../../../../base/browser/positronReactHooks.js';
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { ActivityItemOutputPlot } from '../../../../services/positronConsole/browser/classes/activityItemOutputPlot.js';

// The setting controlling notebook plot preview height in the console. Kept as a
// literal (rather than imported from the service) to avoid pulling the console
// service module into this component; matches the pattern in activityErrorMessage.
const notebookPlotPreviewHeightSettingId = 'console.notebookPlotPreviewHeight';

// ActivityOutputPlot interface.
export interface ActivityOutputPlotProps {
	activityItemOutputPlot: ActivityItemOutputPlot;
}

const linkTitle = nls.localize('activityOutputPlotLinkTitle', "Select this plot in the Plots pane.");

/**
 * ActivityOutputPlot component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputPlot = (props: ActivityOutputPlotProps) => {
	// For plots emitted by a notebook and previewed in its console, the preview
	// height is driven by a setting and read live, so changing it resizes
	// existing previews right away. A value of 0 hides the preview entirely.
	// Regular console plots fall back to the height defined in CSS.
	const notebookPreviewHeight = usePositronConfiguration<number>(notebookPlotPreviewHeightSettingId);
	const isNotebookConsolePlot = props.activityItemOutputPlot.isNotebookConsolePlot;

	// Handles clicks on the plot. This raises a selection event that eventually
	// selects the plot (by its ID) in the Plots pane.
	const handleClick = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
		props.activityItemOutputPlot.onSelected();
	};

	// When notebook plot previews are disabled, don't render the plot at all.
	if (isNotebookConsolePlot && notebookPreviewHeight <= 0) {
		return null;
	}

	// Render.
	return (
		<>
			<ConsoleOutputLines outputLines={props.activityItemOutputPlot.outputLines} />
			<a className='activity-output-plot'
				title={linkTitle}
				onClick={handleClick}>
				<img
					src={props.activityItemOutputPlot.plotUri}
					style={isNotebookConsolePlot
						? { maxHeight: notebookPreviewHeight }
						: undefined}
				/>
				<span className='inspect codicon codicon-positron-search' />
			</a>
		</>
	);
};
