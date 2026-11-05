/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * Creates a hover manager scoped to the calling component. `Button` only shows its `tooltip` when
 * it is given a hover manager, so every Packages button with a tooltip needs the one returned here.
 * Sharing one manager across sibling buttons makes moving between them show the next tooltip
 * instantly instead of waiting out the hover delay again.
 * @returns The hover manager, or undefined until the first effect has run.
 */
export const usePackagesHoverManager = (): IHoverManager | undefined => {
	const services = usePositronReactServicesContext();
	const [hoverManager, setHoverManager] = useState<IHoverManager>();
	useEffect(() => {
		const disposableStore = new DisposableStore();
		setHoverManager(disposableStore.add(new PositronActionBarHoverManager(
			true,
			services.configurationService,
			services.hoverService
		)));
		return () => disposableStore.dispose();
	}, [services.configurationService, services.hoverService]);
	return hoverManager;
};
