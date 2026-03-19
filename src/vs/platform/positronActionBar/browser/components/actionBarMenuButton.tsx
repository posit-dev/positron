/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarMenuButton.css';

// React.
import { PropsWithChildren, useEffect, useRef } from 'react';

// Other dependencies.
import { disposeIfDisposable } from '../../../../base/common/lifecycle.js';
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
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext();

	// Reference hooks.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);


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

	const { actions: getActions } = props;

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	/**
	 * Shows the menu.
	 * @returns A Promise<void> that resolves when the menu is shown.
	 */
	const showMenu = async () => {
		// Get the actions. If there are no actions, return.
		const actions = await getActions();
		if (!actions.length) {
			return;
		}

		// Set the menu showing state and show the context menu.
		positronActionBarContext.setMenuShowing(true);
		services.contextMenuService.showContextMenu({
			getActions: () => actions,
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
			onHide: () => {
				// Update the menu showing state.
				positronActionBarContext.setMenuShowing(false);

				// Dispose all disposable actions.
				disposeIfDisposable(actions);
			},
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
					// Run the preferred action (checked action, or first action if none checked).
					const actions = await getActions();
					const defaultAction = actions.find(action => action.checked) || actions[0];
					await defaultAction?.run();

					// Dispose all disposable actions.
					disposeIfDisposable(actions);
				}
			}}
		/>
	);
};
