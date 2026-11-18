/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './plotLocatorBanner.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * The height of the banner in pixels. Must match `.plot-locator-banner` in plotLocatorBanner.css.
 * The plot instance gives this space back by shrinking the image area.
 */
export const PLOT_LOCATOR_BANNER_HEIGHT = 28;

/**
 * PlotLocatorPromptProps interface.
 */
interface PlotLocatorPromptProps {
	onFinish: () => void;
}

/**
 * PlotLocatorPrompt component. Tells the user that a locator() call is waiting for a click on the
 * plot, and lets them end it. The Plots pane shows it in the plot info header.
 * @param props A PlotLocatorPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotLocatorPrompt = (props: PlotLocatorPromptProps) => {
	return (
		<span className='plot-locator-prompt' role='status'>
			<span className='plot-locator-message'>
				{localize('positron.plots.locator.message', "Click the plot to choose a point.")}
			</span>
			<Button className='plot-locator-finish' onPressed={props.onFinish}>
				{localize('positron.plots.locator.finish', "Finish")}
			</Button>
		</span>
	);
};

/**
 * PlotLocatorBanner component. Shows the locator prompt in its own row above the plot, for plots
 * that have no plot info header, such as a plot in an editor tab.
 * @param props A PlotLocatorPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const PlotLocatorBanner = (props: PlotLocatorPromptProps) => {
	return (
		<div className='plot-locator-banner'>
			<PlotLocatorPrompt onFinish={props.onFinish} />
		</div>
	);
};
