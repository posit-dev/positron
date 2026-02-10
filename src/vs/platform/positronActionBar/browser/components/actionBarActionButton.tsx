/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarActionButton.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { ActionBarButton } from './actionBarButton.js';
import { IAction } from '../../../../base/common/actions.js';
import { MenuItemAction } from '../../../actions/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { actionTooltip, toMenuItemAction } from '../../common/helpers.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { useStateRef } from '../../../../base/browser/ui/react/useStateRef.js';
import { isPositronActionBarButtonOptions } from '../../../action/common/action.js';
import { IAccessibilityService } from '../../../accessibility/common/accessibility.js';
import { IModifierKeyStatus, ModifierKeyEmitter } from '../../../../base/browser/dom.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * Determines whether the alternative action should be used.
 * @param accessibilityService The accessibility service.
 * @param menuItemAction The menu item action.
 * @param mouseOver Whether the mouse is over the action bar action button.
 * @param modifierKeyStatus The modifier key status.
 * @returns A value which indicates whether the alternative action should be used.
 */
const shouldUseAlternativeAction = (
	accessibilityService: IAccessibilityService,
	menuItemAction?: MenuItemAction,
	mouseOver?: boolean,
	modifierKeyStatus?: IModifierKeyStatus
) => {
	// If a menu item action was not supplied, return false
	if (!menuItemAction) {
		return false;
	}

	// If there isn't an alt action, or there is and it's not enabled, return false
	if (!menuItemAction.alt?.enabled) {
		return false;
	}

	// If the modifier key status was not supplied, get it from the modifier key emitter.
	if (!modifierKeyStatus) {
		modifierKeyStatus = ModifierKeyEmitter.getInstance().keyStatus;
	}

	// If motion is not reduced and the alt key is pressed, return true.
	if (!accessibilityService.isMotionReduced() && modifierKeyStatus.altKey) {
		return true;
	}

	// If the mouse is over the action bar action button and the shift or alt key is pressed, return
	// true.
	if (mouseOver && (modifierKeyStatus.shiftKey || modifierKeyStatus.altKey)) {
		return true;
	}

	// Do not use the alternative action.
	return false;
};

/**
 * ActionBarActionButtonProps interface.
 */
interface ActionBarActionButtonProps {
	readonly action: IAction;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarCommandButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarActionButton = (props: ActionBarActionButtonProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Get the menu item action.
	const menuItemAction = toMenuItemAction(props.action);

	// State hooks.
	const [, setMouseInside, mouseInsideRef] = useStateRef(false);
	const [useAlternativeAction, setUseAlternativeAction] = useState(shouldUseAlternativeAction(services.accessibilityService, menuItemAction));

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Get the modifier key emitter and add the event listener to it.
		const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
		disposableStore.add(modifierKeyEmitter.event(modifierKeyStatus => {
			setUseAlternativeAction(shouldUseAlternativeAction(
				services.accessibilityService,
				menuItemAction,
				mouseInsideRef.current,
				modifierKeyStatus
			));
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [services.accessibilityService, menuItemAction, mouseInsideRef]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Get the action we're going to render.
	const action = menuItemAction && useAlternativeAction && menuItemAction.alt?.enabled ?
		menuItemAction.alt :
		props.action;

	// Render.
	return (
		<ActionBarButton
			ref={buttonRef}
			ariaLabel={action.label ?? action.tooltip}
			checked={action.checked}
			disabled={!action.enabled}
			icon={menuItemAction?.item.icon}
			label={isPositronActionBarButtonOptions(menuItemAction?.positronActionBarOptions) && menuItemAction.positronActionBarOptions.displayTitle ?
				action.label :
				undefined
			}
			tooltip={actionTooltip(
				services.contextKeyService,
				services.keybindingService,
				action,
				!useAlternativeAction
			)}
			onMouseEnter={() => setMouseInside(true)}
			onMouseLeave={() => setMouseInside(false)}
			onPressed={async () => {
				try {
					await action.run();
				} catch (error) {
					console.log(error);
				}
			}}
		/>
	);
};
