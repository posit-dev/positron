/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { MenuId } from 'vs/platform/actions/common/actions';

/**
 * TopBarMenuButtonProps interface.
 */
interface TopBarMenuButtonProps {
	menuId: MenuId;
	iconClassName: string;
	tooltip: string;
}

const kMenuYOffset = 5;

/**
 * TopBarCommandButton component.
 * @param props A TopBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarMenuButton = (props: TopBarMenuButtonProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();
	const buttonRef = React.useRef<HTMLDivElement>(null);

	const showMenu = () => {
		if (buttonRef.current) {
			positronTopBarContext?.contextMenuService.showContextMenu({
				menuId: props.menuId,
				getAnchor: () => {
					const buttonEl = buttonRef.current!;
					const rect = buttonEl.getBoundingClientRect();
					return {
						x: rect.x, y: rect.y + rect.height + kMenuYOffset
					};
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

