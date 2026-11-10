/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { createContext, useContext, useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { IHoverManager } from '../../hover/browser/hoverManager.js';
import { IHoverService } from '../../hover/browser/hover.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { PositronActionBarHoverManager } from './positronActionBarHoverManager.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';

/**
 * Provides a hover manager to the components below it, so they share it instead of each creating
 * their own. Undefined when no provider is above, in which case usePositronHoverManager creates one.
 */
export const PositronHoverManagerContext = createContext<IHoverManager | undefined>(undefined);

/**
 * Creates the real hover manager the first time a hover is shown, which happens in an event handler
 * after the component has committed, never during render. This lets the provider create it while
 * rendering without leaking when React discards and retries a render (for example after a child
 * throws).
 */
class LazyHoverManager implements IHoverManager, IDisposable {
	private _hoverManager?: PositronActionBarHoverManager;

	constructor(
		private readonly _configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService
	) { }

	showHover(target: HTMLElement, content?: string | (() => string | undefined)): void {
		this._hoverManager ??= new PositronActionBarHoverManager(
			true,
			this._configurationService,
			this._hoverService
		);
		this._hoverManager.showHover(target, content);
	}

	hideHover(): void {
		this._hoverManager?.hideHover();
	}

	dispose(): void {
		this._hoverManager?.dispose();
		this._hoverManager = undefined;
	}
}

/**
 * Provides one hover manager to every component below it. Must be rendered inside a
 * PositronReactServicesContext provider.
 */
export const PositronHoverManagerProvider = ({ children }: { children: React.ReactNode }) => {
	const services = usePositronReactServicesContext();
	const [hoverManager] = useState(() => new LazyHoverManager(
		services.configurationService,
		services.hoverService
	));
	useEffect(() => () => hoverManager.dispose(), [hoverManager]);

	return (
		<PositronHoverManagerContext.Provider value={hoverManager}>
			{children}
		</PositronHoverManagerContext.Provider>
	);
};

/**
 * Gets the hover manager a component should use. `Button` and similar controls only show their
 * tooltip when given a hover manager. Sharing one manager across sibling controls makes moving
 * between them show the next tooltip instantly instead of waiting out the hover delay again.
 *
 * The manager comes from the first of these that is available:
 * 1. The `hoverManager` argument, typically a prop the parent passes down.
 * 2. The nearest {@link PositronHoverManagerContext}.
 * 3. A manager this hook creates for the calling component and disposes on unmount. Nothing is
 *    created when one of the first two supplies a manager.
 *
 * @param hoverManager Optional hover manager supplied by the caller.
 * @returns The hover manager, or undefined until the hook's own manager has been created.
 */
export const usePositronHoverManager = (hoverManager?: IHoverManager): IHoverManager | undefined => {
	const services = usePositronReactServicesContext();
	const contextHoverManager = useContext(PositronHoverManagerContext);
	const providedHoverManager = hoverManager ?? contextHoverManager;

	const [ownHoverManager, setOwnHoverManager] = useState<IHoverManager>();
	useEffect(() => {
		if (providedHoverManager) {
			setOwnHoverManager(undefined);
			return;
		}
		const disposableStore = new DisposableStore();
		setOwnHoverManager(disposableStore.add(new PositronActionBarHoverManager(
			true,
			services.configurationService,
			services.hoverService
		)));
		return () => disposableStore.dispose();
	}, [providedHoverManager, services.configurationService, services.hoverService]);

	return providedHoverManager ?? ownHoverManager;
};
