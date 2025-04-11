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
import { isPositronActionBarCheckboxOptions } from '../../../action/common/action.js';

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

	// Render.
	return (
		<ActionBarCheckbox
			ref={buttonRef}
			ariaLabel={props.action.label ?? props.action.tooltip}
			checked={isPositronActionBarCheckboxOptions(menuItemAction?.item.positronActionBarOptions) ?
				context.contextKeyService.contextMatchesRules(menuItemAction.item.positronActionBarOptions.checked) :
				props.action.checked
			}
			label={menuItemAction?.label ?? props.action.label}
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
