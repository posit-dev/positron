/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./actionBarMenuButton';

// React.
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { IAction } from 'vs/base/common/actions';
import { IContextMenuEvent } from 'vs/base/browser/contextmenu';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { useRegisterWithActionBar } from 'vs/platform/positronActionBar/browser/useRegisterWithActionBar';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * ActionBarMenuButtonProps interface.
 */
interface ActionBarMenuButtonProps {
	readonly iconId?: string;
	readonly iconFontSize?: number;
	readonly text?: string;
	readonly ariaLabel?: string;
	readonly maxTextWidth?: number;
	readonly align?: 'left' | 'right';
	readonly tooltip?: string | (() => string | undefined);
	readonly hideDropdownIndicator?: boolean;
	readonly actions: () => readonly IAction[] | Promise<readonly IAction[]>;
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
	return (
		<ActionBarButton
			ref={buttonRef}
			{...props}
			showDropdownIndicator={
				props.hideDropdownIndicator ? !props.hideDropdownIndicator : true
			}
			onPressed={pressedHandler}
		/>
	);
};
