/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies
import * as nls from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IAction, Separator } from 'vs/base/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PlotSizingPolicyCustom } from 'vs/workbench/services/positronPlots/common/sizingPolicyCustom';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { showSetPlotSizeModalDialog } from 'vs/workbench/contrib/positronPlots/browser/modalDialogs/setPlotSizeModalDialog';

interface SizingPolicyMenuButtonProps {
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly notificationService: INotificationService;
	readonly plotsService: IPositronPlotsService;
}

const sizingPolicyTooltip = nls.localize('positronSizingPolicyTooltip', "Set how the plot's shape and size are determined");
const newCustomPolicyTooltip = nls.localize('positronNewCustomSize', "New Custom Size...");
const changeCustomPolicyTooltip = nls.localize('positronChangeCustomSize', "Change Custom Size...");

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

		// Update the active policy label when the selected policy's name changes.
		let didChangeSizingPolicyDisposable = props.plotsService.selectedSizingPolicy.onDidUpdateName?.((name) => {
			setActivePolicyLabel(name);
		});

		// Update the active policy label when the selected policy changes.
		disposables.add(props.plotsService.onDidChangeSizingPolicy(policy => {
			setActivePolicyLabel(policy.name);

			// Update the active policy label when the selected policy's name changes.
			didChangeSizingPolicyDisposable?.dispose();
			didChangeSizingPolicyDisposable = policy.onDidUpdateName?.((name) => {
				setActivePolicyLabel(name);
			});
		}));
		return () => {
			disposables.dispose();
			didChangeSizingPolicyDisposable?.dispose();
		};
	}, [props.plotsService, props.plotsService.selectedSizingPolicy]);

	// Builds the actions.
	const actions = () => {
		const selectedPolicy = props.plotsService.selectedSizingPolicy;

		// Build the actions for all sizing policies except the custom policy.
		const actions: IAction[] = [];
		props.plotsService.sizingPolicies.map(policy => {
			if (policy.id !== PlotSizingPolicyCustom.ID) {
				actions.push({
					id: policy.id,
					label: policy.name,
					tooltip: '',
					class: undefined,
					enabled: true,
					checked: policy.id === selectedPolicy.id,
					run: () => {
						props.plotsService.selectSizingPolicy(policy.id);
					}
				});
			}
		});

		// Add a separator and the custom policy, if it exists.
		actions.push(new Separator());
		const customPolicy = props.plotsService.sizingPolicies.find(
			policy => policy.id === PlotSizingPolicyCustom.ID) as PlotSizingPolicyCustom;
		if (customPolicy) {
			actions.push({
				id: customPolicy.id,
				label: customPolicy.name,
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: customPolicy.id === selectedPolicy.id,
				run: () => {
					props.plotsService.selectSizingPolicy(customPolicy.id);
				}
			});
		}

		actions.push({
			id: 'custom',
			label: customPolicy ? changeCustomPolicyTooltip : newCustomPolicyTooltip,
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				showSetPlotSizeModalDialog(
					props.keybindingService,
					props.layoutService,
					customPolicy ? customPolicy.size : undefined,
					result => {
						if (result === null) {
							// The user clicked the delete button; this results in a special `null`
							// value that signals that the custom policy should be deleted.
							props.plotsService.clearCustomPlotSize();
						} else if (result) {
							if (result.size.width < 100 || result.size.height < 100) {
								// The user entered a size that's too small. Plots drawn at this
								// size would be too small to be useful, so we show an error
								// message.
								props.notificationService.error(
									nls.localize(
										'positronPlotSizeTooSmall',
										"The custom plot size {0}×{1} is invalid. The size must be at least 100×100.",
										result.size.width,
										result.size.height
									)
								);
							} else {
								// The user entered a valid size; set the custom policy.
								props.plotsService.setCustomPlotSize(result.size);
							}
						}
					}
				);
			}
		});

		return actions;
	};

	return (
		<ActionBarMenuButton
			iconId='symbol-ruler'
			text={activePolicyLabel}
			tooltip={sizingPolicyTooltip}
			actions={actions}
		/>
	);
};
