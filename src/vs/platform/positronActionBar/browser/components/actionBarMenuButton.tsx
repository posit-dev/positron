/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarMenuButton.css';

// React.
import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { ActionBarButton } from './actionBarButton.js';
import { Icon } from '../../../action/common/action.js';
import { IAction } from '../../../../base/common/actions.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { IContextMenuEvent } from '../../../../base/browser/contextmenu.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { MouseTrigger } from '../../../../base/browser/ui/positronComponents/button/button.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * ActionBarMenuButtonProps interface.
 */
interface ActionBarMenuButtonProps {
	readonly icon?: Icon;
	readonly iconFontSize?: number;
	readonly label?: string;
	readonly ariaLabel?: string;
	readonly dropdownAriaLabel?: string;
	readonly maxTextWidth?: number;
	readonly align?: 'left' | 'right';
	readonly tooltip?: string | (() => string | undefined);
	readonly dropdownTooltip?: string | (() => string | undefined);
	readonly dropdownIndicator?: 'disabled' | 'enabled' | 'enabled-split';
	readonly disabled?: boolean;
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
export const ActionBarMenuButton = (props: PropsWithChildren<ActionBarMenuButtonProps>) => {
	// Destructure props.
	const { actions: getActions } = props;

	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
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

	const updateDefaultAction = React.useCallback(async () => {
		const actions = await getActions();
		const defaultAction = actions.find(action => action.checked);
		setDefaultAction(defaultAction);
	}, [getActions]);

	useEffect(() => {
		updateDefaultAction();
	}, [updateDefaultAction]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	/**
	 * Shows the menu.
	 * @returns A Promise<void> that resolves when the menu is shown.
	 */
	const showMenu = async () => {
		// Get fresh actions directly to avoid stale state from rapid clicks
		const freshActions = await getActions();
		if (!freshActions.length) {
			return;
		}

		// Set the menu showing state and show the context menu.
		positronActionBarContext.setMenuShowing(true);
		services.contextMenuService.showContextMenu({
			getActions: () => freshActions,
			getAnchor: () => buttonRef.current,
			getKeyBinding: (action: IAction) => {
				return services.keybindingService.lookupKeybinding(action.id);
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
			contextKeyService: services.contextKeyService
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
					// Run the preferred action, fetching fresh if needed
					if (defaultAction) {
						defaultAction.run();
					} else {
						const freshActions = await getActions();
						freshActions[0]?.run();
					}
				}
			}}
		/>
	);
};
