/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';


/**
 * Bundle of services that are passed to React-Land in the form of context.
 */
interface ServiceBundle {
	instantiationService: IInstantiationService;
}

/**
 * Context to be used by React components to get access to the services provided by the extension host.
 */
export const ServiceBundleContext = React.createContext<ServiceBundle | undefined>(undefined);

/**
 * Hook to be used by React components to get access to the services provided by the extension host.
 */
export function ServicesProvider({
	services,
	children
}: { services: ServiceBundle; children: React.ReactNode }) {
	return <ServiceBundleContext.Provider value={services}>{children}</ServiceBundleContext.Provider>;
}

/**
 * Hook to be used by React components to get access to the services provided by the extension host.
 */
export function useServices() {
	const serviceBundle = React.useContext(ServiceBundleContext);
	if (!serviceBundle) {
		throw new Error('No serviceBundle provided');
	}
	return serviceBundle;
}

