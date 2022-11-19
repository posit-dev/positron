/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarMenuButton';
import * as React from 'react';
import { IAction } from 'vs/base/common/actions';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IContextMenuEvent } from 'vs/base/browser/contextmenu';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * ActionBarMenuButtonProps interface.
 */
interface ActionBarMenuButtonProps {
	iconId: string;
	text?: string;
	maxTextWidth?: number;
	align?: 'left' | 'right';
	tooltip: string;
	actions: () => Promise<readonly IAction[]>;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarMenuButtonProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarMenuButton = (props: ActionBarMenuButtonProps) => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const buttonRef = React.useRef<HTMLDivElement>(undefined!);

	// Handlers.
	const clickHandler = () => {
		props.actions().then(actions => {
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
				anchorAlignment: AnchorAlignment.LEFT,
				anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
				contextKeyService: positronActionBarContext.contextKeyService
			});
		});
	};

	// Render.
	return <ActionBarButton {...props} ref={buttonRef} dropDown={true} onClick={clickHandler} />;
};
