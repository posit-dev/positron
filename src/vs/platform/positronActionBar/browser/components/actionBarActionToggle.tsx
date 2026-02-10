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

	// Get the menu item action.
	const menuItemAction = toMenuItemAction(props.action);
	if (!menuItemAction) {
		return null;
	}

	// Get the Positron action bar toggle options. This must be defined and the toggled context ket expression must be defined.
	// If this is not the case, render nothing. This prevents the toggle from being rendered when its initial state isn't know.
	const positronActionBarToggleOptions = toPositronActionBarToggleOptions(menuItemAction.positronActionBarOptions);
	if (!positronActionBarToggleOptions || !positronActionBarToggleOptions.toggled) {
		return null;
	}

	// Render.
	return (
		<ActionBarToggle
			ref={buttonRef}
			ariaLabel={props.action.label ?? props.action.tooltip}
			leftTitle={isLocalizedString(positronActionBarToggleOptions.leftTitle) ? positronActionBarToggleOptions.leftTitle.value : positronActionBarToggleOptions.leftTitle}
			rightTitle={isLocalizedString(positronActionBarToggleOptions.rightTitle) ? positronActionBarToggleOptions.rightTitle.value : positronActionBarToggleOptions.rightTitle}
			toggled={services.contextKeyService.contextMatchesRules(positronActionBarToggleOptions.toggled)}
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
