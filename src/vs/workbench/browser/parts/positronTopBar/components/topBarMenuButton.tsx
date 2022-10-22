/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

// menubarControl.ts

import React = require('react');
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { IAction } from 'vs/base/common/actions';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';

/**
 * TopBarMenuButtonProps interface.
 */
interface TopBarMenuButtonProps {
	iconClassName: string;
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
	const context = usePositronTopBarContext();
	const buttonRef = React.useRef<HTMLDivElement>(null);

	const showMenu = () => {
		if (buttonRef.current) {
			props.actions().then(actions => {
				if (actions.length > 0) {
					context?.contextMenuService.showContextMenu({
						getActions: () => actions,
						getAnchor: () => buttonRef.current!,
						getKeyBinding: (action: IAction) => {
							console.log('getKeyBinding: ' + action.id);
							return context.keybindingService.lookupKeybinding(action.id);
						},
						anchorAlignment: AnchorAlignment.LEFT,
						anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
					});
				}
			});
		}

	};

	return (
		<>
			<TopBarButton ref={buttonRef} dropDown={true} iconClassName={props.iconClassName} tooltip={props.tooltip} execute={showMenu} />
		</>
	);


};

