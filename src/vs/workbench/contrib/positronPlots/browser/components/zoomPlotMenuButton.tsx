/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';

export enum ZoomLevel {
	Fit = 0,
	Fifty = 0.5,
	SeventyFive = 0.75,
	OneHundred = 1,
	TwoHundred = 2,
}

interface ZoomPlotMenuButtonProps {
	readonly actionHandler: (zoomLevel: ZoomLevel) => void;
	readonly zoomLevel: number;
}

const zoomLevelMap = new Map<ZoomLevel, string>([
	[ZoomLevel.Fit, nls.localize('positronZoomFit', 'Fit')],
	[ZoomLevel.Fifty, nls.localize('positronZoomFifty', '50%')],
	[ZoomLevel.SeventyFive, nls.localize('positronZoomSeventyFive', '75%')],
	[ZoomLevel.OneHundred, nls.localize('positronZoomActual', '100%')],
	[ZoomLevel.TwoHundred, nls.localize('positronZoomDouble', '200%')],
]);
const zoomPlotTooltip = nls.localize('positronZoomPlotTooltip', "Set the plot zoom");

/**
 * SizingPolicyMenuButton component.
 * @param props A SizingPolicyMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ZoomPlotMenuButton = (props: ZoomPlotMenuButtonProps) => {
	const zoomLevels = [ZoomLevel.Fit, ZoomLevel.Fifty, ZoomLevel.SeventyFive, ZoomLevel.OneHundred, ZoomLevel.TwoHundred];
	// State.
	const [activeZoomLabel, setActiveZoomLabel] =
		React.useState(zoomLevelMap.get(props.zoomLevel) || ZoomLevel[props.zoomLevel]);

	// Builds the actions.
	const actions = () => {
		const actions: IAction[] = [];

		zoomLevels.forEach((zoomLevel) => {
			const zoomLabel = zoomLevelMap.get(zoomLevel) || ZoomLevel[zoomLevel];

			actions.push({
				id: ZoomLevel[zoomLevel],
				label: zoomLabel,
				tooltip: '',

				class: undefined,
				enabled: true,
				run: () => {
					setActiveZoomLabel(zoomLabel);
					props.actionHandler(zoomLevel);
				}
			});
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			actions={actions}
			iconId='positron-size-to-fit'
			text={activeZoomLabel}
			tooltip={zoomPlotTooltip}
		/>
	);
};
