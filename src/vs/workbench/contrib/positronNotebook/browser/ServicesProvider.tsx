/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ISize } from '../../../../base/browser/positronReactRenderer.js';
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IWebviewService } from '../../webview/browser/webview.js';
import { IPositronWebviewPreloadService } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';

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
	 * Service for creating webviews for notebook outputs
	 */
	notebookWebviewService: IPositronNotebookOutputWebviewService;

	webviewPreloadService: IPositronWebviewPreloadService;

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

	/**
	 * Service for managing active editors and editor state
	 */
	editorService: IEditorService;

	/**
	 * Service for managing workbench layout and panel positions
	 */
	layoutService: IWorkbenchLayoutService;

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
