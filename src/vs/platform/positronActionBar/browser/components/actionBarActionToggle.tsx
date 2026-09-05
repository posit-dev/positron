/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarActionToggle.css';

// React.
import { useRef } from 'react';

// Other imports.
import { ActionBarToggle } from './actionBarToggle.js';
import { localize } from '../../../../nls.js';
import { IAction } from '../../../../base/common/actions.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { actionTooltip, toMenuItemAction } from '../../common/helpers.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { isLocalizedString, isPositronActionBarToggleOptions, PositronActionBarOptions } from '../../../action/common/action.js';

/**
 * Gets the Positron action bar toggle options.
 * @param positronActionBarOptions The Positron action bar options.
 * @returns The Positron action bar toggle options or undefined.
 */
export const toPositronActionBarToggleOptions = (positronActionBarOptions?: PositronActionBarOptions) =>
	isPositronActionBarToggleOptions(positronActionBarOptions) ? positronActionBarOptions : undefined;

/**
 * ActionBarActionToggleProps interface.
 */
interface ActionBarActionToggleProps {
	readonly action: IAction;
}

/**
 * ActionBarActionToggle component.
 * @param props An ActionBarActionToggleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarActionToggle = (props: ActionBarActionToggleProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Get the menu item action and the Positron action bar toggle options. The options and their
	// toggled expression must both be defined; otherwise the toggle has no state to show and
	// nothing is rendered.
	const menuItemAction = toMenuItemAction(props.action);
	const positronActionBarToggleOptions = toPositronActionBarToggleOptions(menuItemAction?.positronActionBarOptions);

	if (!menuItemAction || !positronActionBarToggleOptions?.toggled) {
		return null;
	}

	const leftTitle = isLocalizedString(positronActionBarToggleOptions.leftTitle) ? positronActionBarToggleOptions.leftTitle.value : positronActionBarToggleOptions.leftTitle;
	const rightTitle = isLocalizedString(positronActionBarToggleOptions.rightTitle) ? positronActionBarToggleOptions.rightTitle.value : positronActionBarToggleOptions.rightTitle;

	// A switch announces "on" and "off", never the option names, so name it after the option that
	// "on" stands for. The left option is the one SegmentedToggle reports as checked, so a toggle
	// labelled "Edit Mode" with a left title of "Source" announces "Edit Mode: Source, switch, on"
	// when Source is active and "off" when Visual is.
	const label = props.action.label ?? props.action.tooltip;
	const ariaLabel = leftTitle ? localize('positron.actionBarToggle.ariaLabel', "{0}: {1}", label, leftTitle) : label;

	// Render.
	return (
		<ActionBarToggle
			ref={buttonRef}
			ariaLabel={ariaLabel}
			disabled={!menuItemAction.enabled}
			leftTitle={leftTitle}
			rightTitle={rightTitle}
			toggled={menuItemAction.checked ?? false}
			tooltip={actionTooltip(
				services.contextKeyService,
				services.keybindingService,
				props.action,
				false
			)}
			onChanged={_ => {
				try {
					props.action.run();
				} catch (error) {
					console.log(error);
				}
			}}
		/>
	);
};
