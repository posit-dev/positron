/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IScopedContextKeyService } from 'vs/platform/contextkey/common/contextkey';

/**
 * Function that provides a context key service for a given container.
 */
type ScopedContextKeyProviderCallback = (container: HTMLElement) => IScopedContextKeyService;

/**
 * _React_ context object for passing down a _VSCode_ scoped context key provider function.
 */
const ContextKeyProviderCallbackContext = React.createContext<
	ScopedContextKeyProviderCallback | undefined
>(undefined);

/**
 * A _React_ provider component to provide a _VSCode_ scoped context key provider function to child
 * components.
 * @param contextKeyServiceProvider Function that provides a context key service for a given
 * container.
 * @param children Child components.
 */
export function ContextKeyProvider({
	contextKeyServiceProvider,
	children
}: { contextKeyServiceProvider: ScopedContextKeyProviderCallback; children: React.ReactNode }) {
	return <ContextKeyProviderCallbackContext.Provider value={contextKeyServiceProvider}>
		{children}
	</ContextKeyProviderCallbackContext.Provider>;
}


/**
 * Hook to be used by React components to get access to the context key service.
 * @returns The context key service provider for the closest context key provider parent.
 */
export function useContextKeyServiceProvider() {
	const contextKeyProvider = React.useContext(ContextKeyProviderCallbackContext);
	if (!contextKeyProvider) {
		throw new Error('No contextKeyProvider provided');
	}
	return contextKeyProvider;
}

