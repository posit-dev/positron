/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarActionCheckbox.css';

// React.
import React, { useRef } from 'react';

// Other imports.
import { ActionBarCheckbox } from './actionBarCheckbox.js';
import { IAction } from '../../../../base/common/actions.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { actionTooltip, toMenuItemAction } from '../../common/helpers.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { isICommandActionToggleInfo } from '../../../action/common/action.js';

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
	const context = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Get the menu item action.
	const menuItemAction = toMenuItemAction(props.action);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Get the checked state.
	let checked: boolean | undefined;
	if (!menuItemAction) {
		checked = props.action.checked;
	} else {
		if (isICommandActionToggleInfo(menuItemAction.item.toggled)) {
			checked = context.contextKeyService.contextMatchesRules(menuItemAction.item.toggled.condition);
		} else {
			checked = context.contextKeyService.contextMatchesRules(menuItemAction.item.toggled);
		}
	}

	// Get the label to display on the action bar button.
	const label = menuItemAction ?
		menuItemAction.displayLabelOnActionBar ?
			menuItemAction.label :
			undefined :
		undefined;

	// Render.
	return (
		<ActionBarCheckbox
			ref={buttonRef}
			ariaLabel={props.action.label ?? props.action.tooltip}
			checked={checked}
			label={label}
			tooltip={actionTooltip(
				context.contextKeyService,
				context.keybindingService,
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
