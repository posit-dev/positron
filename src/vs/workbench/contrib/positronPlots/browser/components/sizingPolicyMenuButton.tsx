/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

interface SizingPolicyMenuButtonProps {
	readonly plotsService: IPositronPlotsService;
}

/**
 * SizingPolicyMenuButton component.
 * @param props A SizingPolicyMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const SizingPolicyMenuButton = (props: SizingPolicyMenuButtonProps) => {

	// State.
	const [activePolicyLabel, setActivePolicyLabel] =
		React.useState(props.plotsService.selectedSizingPolicy.name);

	React.useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(props.plotsService.onDidChangeSizingPolicy(policy => {
			setActivePolicyLabel(policy.name);
		}));
		return () => disposables.dispose();
	}, [props.plotsService.selectedSizingPolicy]);

	// Builds the actions.
	const actions = () => {
		// Build the actions for the available console repl instances.
		const actions: IAction[] = [];
		props.plotsService.sizingPolicies.map(policy => {
			actions.push({
				id: policy.id,
				label: policy.name,
				tooltip: '',
				class: undefined,
				enabled: true,
				run: () => {
					props.plotsService.selectSizingPolicy(policy.id);
				}
			});
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			iconId='symbol-ruler'
			text={activePolicyLabel}
			actions={actions}
		/>
	);
};
