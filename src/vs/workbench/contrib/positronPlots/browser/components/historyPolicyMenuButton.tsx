/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { HistoryPolicy, IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import * as nls from '../../../../../nls.js';

interface HistoryPolicyMenuButtonProps {
	readonly plotsService: IPositronPlotsService;
}

// Labels for the menu. We compute these here because `localize()` doesn't work in React code.
const historyPolicyNeverLabel = nls.localize('positron.historyPolicyNeverLabel', "Never");
const historyPolicyAutoLabel = nls.localize('positron.historyPolicyAutoLabel', "Auto");
const historyPolicyAlwaysLabel = nls.localize('positron.historyPolicyAlwaysLabel', "Always");

const historyPolicyTooltip = nls.localize('positronHistoryPolicyTooltip', "Set whether the plot history filmstrip is visible");
/**
 * HistoryPolicyMenuButton component.
 * @param props A HistoryPolicyMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const HistoryPolicyMenuButton = (props: HistoryPolicyMenuButtonProps) => {

	const labelForHistoryPolicy = (policy: HistoryPolicy): string => {
		switch (policy) {
			case HistoryPolicy.AlwaysVisible:
				return historyPolicyAlwaysLabel;
			case HistoryPolicy.Automatic:
				return historyPolicyAutoLabel;
			case HistoryPolicy.NeverVisible:
				return historyPolicyNeverLabel;
		}
	};

	// Builds the actions.
	const actions = () => {
		const policies = [HistoryPolicy.AlwaysVisible,
		HistoryPolicy.Automatic,
		HistoryPolicy.NeverVisible];
		const actions: IAction[] = [];
		policies.map(policy => {
			actions.push({
				id: policy,
				label: labelForHistoryPolicy(policy),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: props.plotsService.historyPolicy === policy,
				run: () => {
					props.plotsService.selectHistoryPolicy(policy);
				}
			});
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			actions={actions}
			align='right'
			ariaLabel={historyPolicyTooltip}
			iconId='layout'
			tooltip={historyPolicyTooltip}
		/>
	);
};
