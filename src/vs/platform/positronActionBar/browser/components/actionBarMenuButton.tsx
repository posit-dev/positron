/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarMenuButton.css';

// React.
import React, { PropsWithChildren, useEffect, useRef } from 'react';

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

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	/**
	 * Shows the menu.
	 * @returns A Promise<void> that resolves when the menu is shown.
	 */
	const showMenu = async () => {
		// Guard against showing menu when one is already showing
		if (positronActionBarContext.menuShowing) {
			console.log('POSITRON ACTION BAR: Menu already showing, ignoring request');
			return;
		}

		// Get fresh actions directly to avoid stale state from rapid clicks
		const timestamp = Date.now();
		console.log(`[${timestamp}] POSITRON ACTION BAR: Showing menu from ActionBarMenuButton`);
		const freshActions = await getActions();
		if (!freshActions.length) {
			console.log(`[${timestamp}] POSITRON ACTION BAR: No actions to show in menu`);
			return;
		}

		// Ensure button is visible and has valid geometry
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) {
			console.warn(`[${timestamp}] POSITRON ACTION BAR: Button has invalid geometry, cannot show menu`, rect);
			return;
		}
		console.log(`[${timestamp}] POSITRON ACTION BAR: Button geometry:`, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });

		// Set the menu showing state and show the context menu.
		console.log(`[${timestamp}] POSITRON ACTION BAR: Setting menuShowing to true`);
		positronActionBarContext.setMenuShowing(true);
		console.log(`[${timestamp}] POSITRON ACTION BAR: About to call showContextMenu`);
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
			onHide: () => {
				const hideTimestamp = Date.now();
				console.log(`[${hideTimestamp}] POSITRON ACTION BAR: Menu onHide called (opened at ${timestamp}, duration: ${hideTimestamp - timestamp}ms)`);
				console.log(`[${hideTimestamp}] POSITRON ACTION BAR: Stack trace:`, new Error().stack);
				positronActionBarContext.setMenuShowing(false);
				console.log(`[${hideTimestamp}] POSITRON ACTION BAR: Menu hidden from ActionBarMenuButton`);
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
				console.log('POSITRON ACTION BAR: ActionBarMenuButton pressed');

				if (props.dropdownIndicator !== 'enabled-split') {
					console.log('POSITRON ACTION BAR: Showing menu because dropdownIndicator is not enabled-split');
					await showMenu();
					return;
				}

				const actions = await getActions();

				const defaultAction = actions.find(action => action.checked);
				// Run the preferred action if it exists
				if (defaultAction) {
					console.log(`POSITRON ACTION BAR: Running default action ${defaultAction.id}`);
					defaultAction.run();
					return;
				}

				console.log('POSITRON ACTION BAR: Default action not found, running first action if it exists');
				actions[0]?.run();
			}}
		/>
	);
};
