/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import React from 'react';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { combinedDisposable } from '../../../../base/common/lifecycle.js';
import { MenuId, IMenuCreateOptions, IMenuService, IMenu } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * React wrapper for an IMenu.
 *
 * @param menuId The menu's identifier
 * @param contextKeyService The context key service used to evaluate menu item visibility and enablement
 * @param options Optional configuration for menu creation
 * @returns An object containing the current menu instance and a version number that increments on menu changes
 */
export function useMenu(
	menuId: MenuId,
	contextKeyService: IContextKeyService | undefined,
	options?: IMenuCreateOptions) {
	// Context
	const menuService = usePositronReactServicesContext().get(IMenuService);

	// State
	const [menu, setMenu] = React.useState<IMenu | undefined>();
	const [version, setVersion] = React.useState(0);

	// Main effect
	React.useEffect(() => {
		if (!contextKeyService) {
			return;
		}

		const menu = menuService.createMenu(menuId, contextKeyService, options);
		setMenu(menu);
		setVersion(0);

		const disposable = combinedDisposable(
			menu,
			menu.onDidChange(() => setVersion(v => v + 1)),
		);
		return () => disposable.dispose();
	}, [menuService, contextKeyService, menuId, options]);

	return { current: menu, version };
}
