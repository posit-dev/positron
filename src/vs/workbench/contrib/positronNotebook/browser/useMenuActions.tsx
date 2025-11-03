/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import React from 'react';
import { MenuItemAction, SubmenuItemAction, IMenuActionOptions } from '../../../../platform/actions/common/actions.js';
import { IVersionedMenu } from './useMenu.js';

/**
 * React hook that retrieves and tracks actions from a versioned menu.
 * Automatically updates when the menu changes.
 * @param menu The versioned menu to retrieve actions from.
 * @param options Optional menu action options to filter or configure the actions.
 * @returns An array of tuples containing group IDs and their associated actions.
 */
export function useMenuActions(
	menu: IVersionedMenu,
	options?: IMenuActionOptions,
) {
	// State
	const [actions, setActions] = React.useState<[string, (MenuItemAction | SubmenuItemAction)[]][]>([]);

	// Main effect
	React.useEffect(() => {
		if (!menu.current) {
			return setActions([]);
		}
		setActions(menu.current.getActions(options));
	}, [menu, options]);

	return actions;
}
