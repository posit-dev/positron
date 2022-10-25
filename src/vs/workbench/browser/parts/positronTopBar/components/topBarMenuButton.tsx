/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

// menubarControl.ts

import React = require('react');
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
	tooltip: string;
	text?: string;
	actions: () => Promise<readonly IAction[]>;
}

/**
 * TopBarCommandButton component.
 * @param props A TopBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarMenuButton = (props: TopBarMenuButtonProps) => {
	// Hooks.
	const context = usePositronTopBarContext();
	const buttonRef = React.useRef<HTMLDivElement>(null);

	const showMenu = (event: React.MouseEvent) => {
		if (buttonRef.current) {
			props.actions().then(actions => {
				if (actions.length > 0) {
					context?.contextMenuService.showContextMenu({
						getActions: () => actions,
						getAnchor: () => buttonRef.current!,
						getKeyBinding: (action: IAction) => {
							return context.keybindingService.lookupKeybinding(action.id);
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
						anchorAlignment: AnchorAlignment.LEFT,
						anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
						contextKeyService: context.contextKeyService
					});
				}
			});
		}

	};

	return (
		<>
			<TopBarButton ref={buttonRef} dropDown={true} iconId={props.iconId} text={props.text} tooltip={props.tooltip} onClick={showMenu} />
		</>
	);


};
