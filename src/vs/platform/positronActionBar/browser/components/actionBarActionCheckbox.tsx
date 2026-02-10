/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarActionCheckbox.css';

// React.
import { useRef } from 'react';

// Other imports.
import { ActionBarCheckbox } from './actionBarCheckbox.js';
import { IAction } from '../../../../base/common/actions.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { actionTooltip, toMenuItemAction } from '../../common/helpers.js';
import { isPositronActionBarCheckboxOptions, PositronActionBarOptions } from '../../../action/common/action.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * Gets the Positron action bar checkbox options.
 * @param positronActionBarOptions The Positron action bar options.
 * @returns The Positron action bar checkbox options or undefined.
 */
export const toPositronActionBarCheckboxOptions = (positronActionBarOptions?: PositronActionBarOptions) =>
	isPositronActionBarCheckboxOptions(positronActionBarOptions) ? positronActionBarOptions : undefined;

/**
 * ActionBarActionCheckboxProps interface.
 */
interface ActionBarActionCheckboxProps {
	readonly action: IAction;
}

/**
 * ActionBarActionCheckbox component.
 * @param props An ActionBarActionCheckboxProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarActionCheckbox = (props: ActionBarActionCheckboxProps) => {
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

	// Get the Positron action bar checkbox options. This must be defined and the checked context ket expression must be defined.
	// If this is not the case, render nothing. This prevents the checkbox from being rendered when its initial state isn't know.
	const positronActionBarCheckboxOptions = toPositronActionBarCheckboxOptions(menuItemAction.positronActionBarOptions);
	if (!positronActionBarCheckboxOptions || !positronActionBarCheckboxOptions.checked) {
		return null;
	}

	// Render.
	return (
		<ActionBarCheckbox
			ref={buttonRef}
			ariaLabel={props.action.label ?? props.action.tooltip}
			checked={services.contextKeyService.contextMatchesRules(positronActionBarCheckboxOptions.checked)}
			label={menuItemAction?.label ?? props.action.label}
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
