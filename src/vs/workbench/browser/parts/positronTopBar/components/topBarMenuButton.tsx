/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { IAction } from 'vs/base/common/actions';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IContextMenuEvent } from 'vs/base/browser/contextmenu';

/**
 * TopBarMenuButtonProps interface.
 */
interface TopBarMenuButtonProps {
	iconId: string;
	text?: string;
	align?: 'left' | 'right';
	tooltip: string;
	actions: () => Promise<readonly IAction[]>;
}

/**
 * TopBarCommandButton component.
 * @param props A TopBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarMenuButton = (props: TopBarMenuButtonProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();
	const buttonRef = React.useRef<HTMLDivElement>(undefined!);

	// Handlers.
	const clickHandler = () => {
		props.actions().then(actions => {
			if (!actions.length) {
				return;
			}

			positronTopBarContext.setMenuShowing(true);
			positronTopBarContext.contextMenuService.showContextMenu({
				getActions: () => actions,
				getAnchor: () => buttonRef.current!,
				getKeyBinding: (action: IAction) => {
					return positronTopBarContext.keybindingService.lookupKeybinding(action.id);
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
				onHide: () => positronTopBarContext.setMenuShowing(false),
				anchorAlignment: AnchorAlignment.LEFT,
				anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
				contextKeyService: positronTopBarContext.contextKeyService
			});
		});
	};

	// Render.
	return (
		<TopBarButton {...props} ref={buttonRef} dropDown={true} onClick={clickHandler} />
	);
};
