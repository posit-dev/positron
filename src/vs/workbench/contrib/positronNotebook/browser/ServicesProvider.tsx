/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ISize } from 'vs/base/browser/positronReactRenderer';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IScopedContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';



/**
 * Bundle of services that are passed to React-Land in the form of context.
 */
interface ServiceBundle {

	/**
	 * The instantiation service that can be used to create new instances of disposables.
	 */
	instantiationService: IInstantiationService;

	/**
	 * The configuration service that can be used to access configuration settings.
	 */
	configurationService: IConfigurationService;

	/**
	 * Service for instantiating text models
	 */
	textModelResolverService: ITextModelService;

	/**
	 * Logging service
	 */
	logService: ILogService;

	/**
	 * Service for creating webviews
	 */
	webviewService: IWebviewService;

	/**
	 * Servicer for opening external links
	 */
	openerService: IOpenerService;

	/**
	 * Service for envoking commands from extensions
	 */
	commandService: ICommandService;

	/**
	 * Service for showing notifications to the user
	 */
	notificationService: INotificationService;

	/**
	 * An observable for the size of the notebook.
	 */
	sizeObservable: ISettableObservable<ISize>;

	/**
	 * A callback to get the scoped context key service for a given container.
	 */
	scopedContextKeyProviderCallback: (container: HTMLElement) => IScopedContextKeyService;

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


