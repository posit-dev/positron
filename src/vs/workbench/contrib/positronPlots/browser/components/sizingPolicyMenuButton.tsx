/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies
import * as nls from '../../../../../nls.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { showSetPlotSizeModalDialog } from '../modalDialogs/setPlotSizeModalDialog.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { disposableTimeout } from '../../../../../base/common/async.js';

interface SizingPolicyMenuButtonProps {
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly notificationService: INotificationService;
	readonly plotsService: IPositronPlotsService;
	readonly plotClient: PlotClientInstance;
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
		React.useState(props.plotClient.sizingPolicy.getName(props.plotClient));

	React.useEffect(() => {
		const disposables = new DisposableStore();

		const attachPolicy = (policy: IPositronPlotSizingPolicy) => {
			const disposables = new DisposableStore();

			// If the intrinsic policy is active and the plot's intrinsic size has not been received,
			// debounce the active policy label update to avoid flickering.
			let debounceTimeout: IDisposable | undefined;
			if (policy instanceof PlotSizingPolicyIntrinsic && !props.plotClient.receivedIntrinsicSize) {
				debounceTimeout = disposableTimeout(() => {
					setActivePolicyLabel(policy.getName(props.plotClient));
				}, 250, disposables);
			} else {
				setActivePolicyLabel(policy.getName(props.plotClient));
			}

			if (policy instanceof PlotSizingPolicyIntrinsic) {
				// Update the active policy label when the selected policy's name changes.
				disposables.add(props.plotClient.onDidSetIntrinsicSize((intrinsicSize) => {
					debounceTimeout?.dispose();
					setActivePolicyLabel(policy.getName(props.plotClient));
				}));
			}

			return disposables;
		};

		let policyDisposables = attachPolicy(props.plotsService.selectedSizingPolicy);

		// Update the active policy label when the selected policy changes.
		disposables.add(props.plotClient.onDidChangeSizingPolicy(policy => {
			policyDisposables.dispose();
			policyDisposables = attachPolicy(policy);
		}));
		return () => {
			disposables.dispose();
			policyDisposables.dispose();
		};
	}, [props.plotsService, props.plotClient, props.plotsService.selectedSizingPolicy]);

	// Builds the actions.
	const actions = () => {
		const selectedPolicy = props.plotsService.selectedSizingPolicy;

		// Build the actions for all sizing policies except the custom policy.
		const actions: IAction[] = [];
		props.plotsService.sizingPolicies.map(policy => {
			if (policy.id !== PlotSizingPolicyCustom.ID) {
				// Only enable the intrinsic policy if the plot's intrinsic size is known.
				const enabled = policy instanceof PlotSizingPolicyIntrinsic ?
					!!props.plotClient.intrinsicSize : true;

				actions.push({
					id: policy.id,
					label: policy.getName(props.plotClient),
					tooltip: '',
					class: undefined,
					enabled,
					checked: policy.id === selectedPolicy.id,
					run: () => {
						props.plotClient.sizingPolicy = policy;
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
				label: customPolicy.getName(props.plotClient),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: customPolicy.id === selectedPolicy.id,
				run: () => {
					props.plotClient.sizingPolicy = customPolicy;
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
								props.plotClient.sizingPolicy = new PlotSizingPolicyCustom(result.size);
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
			actions={actions}
			iconId='symbol-ruler'
			text={activePolicyLabel}
			tooltip={sizingPolicyTooltip}
		/>
	);
};
