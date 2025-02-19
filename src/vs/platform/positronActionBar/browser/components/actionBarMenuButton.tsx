/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarMenuButton.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { IAction } from '../../../../base/common/actions.js';
import { IContextMenuEvent } from '../../../../base/browser/contextmenu.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { ActionBarButton } from './actionBarButton.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { MouseTrigger } from '../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * ActionBarMenuButtonProps interface.
 */
interface ActionBarMenuButtonProps {
	readonly iconId?: string;
	readonly iconFontSize?: number;
	readonly text?: string;
	readonly ariaLabel?: string;
	readonly dropdownAriaLabel?: string;
	readonly maxTextWidth?: number;
	readonly align?: 'left' | 'right';
	readonly tooltip?: string | (() => string | undefined);
	readonly dropdownTooltip?: string | (() => string | undefined);
	readonly dropdownIndicator?: 'disabled' | 'enabled' | 'enabled-split';
	readonly actions: () => readonly IAction[] | Promise<readonly IAction[]>;
}

/**
 * ActionBarCommandButton component.
 *
 * Actions can be set as checked. If `enabled-split` is set then a default action is allowed to run
 * when the button is clicked. The default action is the first action that is checked or the first
 * action if none are checked.
 *
 * @param props An ActionBarMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarMenuButton = (props: ActionBarMenuButtonProps) => {
	// Context hooks.
	const positronActionBarContext = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [actions, setActions] = useState<readonly IAction[]>([]);
	const [defaultAction, setDefaultAction] = useState<IAction | undefined>(undefined);

	// Manage the aria-haspopup and aria-expanded attributes.
	useEffect(() => {
		buttonRef.current.setAttribute('aria-haspopup', 'menu');
	}, []);

	// Manage the aria-expanded attribute.
	useEffect(() => {
		if (positronActionBarContext.menuShowing) {
			buttonRef.current.setAttribute('aria-expanded', 'true');
		} else {
			buttonRef.current.removeAttribute('aria-expanded');
		}
	}, [positronActionBarContext.menuShowing]);

	const getMenuActions = React.useCallback(async () => {
		const actions = await props.actions();
		const defaultAction = actions.find(action => action.checked);

		setDefaultAction(defaultAction);
		setActions(actions);

		return actions;
	}, [props]);

	useEffect(() => {
		getMenuActions();
	}, [getMenuActions]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	/**
	 * Shows the menu.
	 * @returns A Promise<void> that resolves when the menu is shown.
	 */
	const showMenu = async () => {
		// Get the actions. If there are no actions, return.
		if (!actions.length) {
			return;
		}

		// Set the menu showing state and show the context menu.
		positronActionBarContext.setMenuShowing(true);
		positronActionBarContext.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => buttonRef.current,
			getKeyBinding: (action: IAction) => {
				return positronActionBarContext.keybindingService.lookupKeybinding(action.id);
			},
			getActionsContext: (event?: IContextMenuEvent) => {
				if (event) {
					return new KeyboardEvent('keydown', {
						ctrlKey: event.ctrlKey,
						shiftKey: event.shiftKey,
						metaKey: event.metaKey,
						altKey: event.altKey
					});
				} else {
					return undefined;
				}
			},
			onHide: () => positronActionBarContext.setMenuShowing(false),
			anchorAlignment: props.align && props.align === 'right' ? AnchorAlignment.RIGHT : AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			contextKeyService: positronActionBarContext.contextKeyService
		});
	};

	// Render.
	return (
		<ActionBarButton
			ref={buttonRef}
			{...props}
			dropdownIndicator={props.dropdownIndicator ?? 'enabled'}
			mouseTrigger={MouseTrigger.MouseDown}
			onDropdownPressed={async () => await showMenu()}
			onPressed={async () => {
				if (props.dropdownIndicator !== 'enabled-split') {
					await showMenu();
				} else {
					// Run the preferred action.
					defaultAction ? defaultAction.run() : actions[0].run();
				}
			}}
		/>
	);
};
