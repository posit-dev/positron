/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarMenuButton';
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { IAction } from '../../../../base/common/actions.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../base/browser/ui/contextview/contextview.js';
import { IContextMenuEvent } from '../../../../base/browser/contextmenu.js';
import { ActionBarButton } from './actionBarButton.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';

/**
 * ActionBarMenuButtonProps interface.
 */
interface ActionBarMenuButtonProps {
	iconId?: string;
	iconFontSize?: number;
	text?: string;
	ariaLabel?: string;
	maxTextWidth?: number;
	align?: 'left' | 'right';
	tooltip?: string | (() => string | undefined);
	actions: () => readonly IAction[] | Promise<readonly IAction[]>;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarMenuButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarMenuButton = (props: ActionBarMenuButtonProps) => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// Manage the aria-haspopup and aria-expanded attributes.
	useEffect(() => {
		buttonRef.current.setAttribute('aria-haspopup', 'menu');
	}, []);

	useEffect(() => {
		if (positronActionBarContext.menuShowing) {
			buttonRef.current.setAttribute('aria-expanded', 'true');
		} else {
			buttonRef.current.removeAttribute('aria-expanded');
		}

	}, [positronActionBarContext.menuShowing]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Handlers.
	const pressedHandler = async () => {
		// Get the actions.
		const actions = await props.actions();
		if (!actions.length) {
			return;
		}

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
	return <ActionBarButton {...props} ref={buttonRef} dropDown={true} onPressed={pressedHandler} />;
};
