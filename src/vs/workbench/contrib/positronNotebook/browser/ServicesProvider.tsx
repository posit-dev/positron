/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { PositronNotebookWidget } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookWidget';


/**
 * Bundle of services that are passed to React-Land in the form of context.
 */
interface ServiceBundle {
	/**
	 * The notebook widget that is being used to render the notebook. Sometimes refered to as a
	 * "Delegate" in the vscode notebook code.
	 */
	notebookWidget: PositronNotebookWidget;
	/**
	 * The instantiation service that can be used to create new instances of disposables.
	 */
	instantiationService: IInstantiationService;

	/**
	 * The configuration service that can be used to access configuration settings.
	 */
	configurationService: IConfigurationService;
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

