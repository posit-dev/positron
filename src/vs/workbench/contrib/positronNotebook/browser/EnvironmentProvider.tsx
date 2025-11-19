/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ISize } from '../../../../base/browser/positronReactRenderer.js';
import { IObservable } from '../../../../base/common/observable.js';
import { IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * EnvironmentBundle interface.
 */
interface EnvironmentBundle {
	/**
	 * An observable for the size of the notebook.
	 */
	size: IObservable<ISize>;

	/**
	 * A callback to get the scoped context key service for a given container.
	 */
	scopedContextKeyProviderCallback: (container: HTMLElement) => IScopedContextKeyService;
}

/**
 * Context to be used by React components to get access to the services provided by the extension host.
 */
export const EnvironmentBundleContext = React.createContext<EnvironmentBundle | undefined>(undefined);

/**
 * Hook to be used by React components to get access to the services provided by the extension host.
 */
export function EnvironentProvider({
	environmentBundle,
	children
}: { environmentBundle: EnvironmentBundle; children: React.ReactNode }) {
	return <EnvironmentBundleContext.Provider value={environmentBundle}>
		{children}
	</EnvironmentBundleContext.Provider>;
}

/**
 * Hook to be used by React components to get access to the services provided by the extension host.
 */
export function useEnvironment() {
	const environmentBundle = React.useContext(EnvironmentBundleContext);
	if (!environmentBundle) {
		throw new Error('No environmentBundle provided');
	}
	return environmentBundle;
}
