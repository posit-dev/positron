/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry, IViewDescriptor } from 'vs/workbench/common/views';
import { PositronRuntimeSessionsViewPane } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsView';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, } from 'vs/platform/configuration/common/configurationRegistry';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

// The Positron sessions view container and view identifiers.
export const POSITRON_RUNTIME_VIEW_CONTAINER_ID = 'workbench.panel.positronSessions';
export const POSITRON_RUNTIME_SESSIONS_VIEW_ID = 'workbench.view.positronSessions';

// The Positron sessions view icon.
const positronRuntimeSessionsViewIcon = registerIcon(
	'positron-runtime-sessions-view-icon',
	Codicon.versions,
	nls.localize('positronRuntimeSessionsViewIcon', 'View icon of the Positron sessions view.')
);

// The configuration key for showing the sessions view.
const SHOW_SESSIONS_CONFIG_KEY = 'positron.interpreters.showSessions';

// Register configuration options for the runtime service
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		'positron.interpreters.showSessions': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: false,
			description: nls.localize('positron.interpreters.showSessions', "Enable debug Runtimes pane listing active interpreter sessions.")
		},
	}
});


/**
 * The Positron runtime sessions contribution; manages the Positron sessions
 * view. Its main responsibility is managing the state of the view based on the
 * configuration. As the configuration changes, it registers or deregisters the
 * view.
 *
 * We do this in order to avoid showing the view by default, since it is not intended for
 * general use.
 */
class PositronRuntimeSessionsContribution extends Disposable {
	private _viewContainer: ViewContainer | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		// Register the view if the configuration is set to show it.
		if (this._configurationService.getValue<boolean>(SHOW_SESSIONS_CONFIG_KEY)) {
			this.registerSessionsView();
		}

		// Register the configuration change listener. If the user turns on the configuration, we
		// register the view. This allows us to toggle the view on and off without restarting the
		// workbench.
		this._configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(SHOW_SESSIONS_CONFIG_KEY)) {
				if (this._configurationService.getValue<boolean>(SHOW_SESSIONS_CONFIG_KEY)) {
					this.registerSessionsView();
				} else if (this._viewContainer) {
					// Deregister the view if the configuration is set to hide it.
					Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry)
						.deregisterViews([this.runtimeSessionViewDescriptor()], this._viewContainer);
				}
			}
		});
	}

	/**
	 * Registers the Runtimes view container and the Sessions view within it.
	 */
	private registerSessionsView(): void {

		// Register the Positron sessions view container.
		this._viewContainer = Registry.as<IViewContainersRegistry>(
			ViewContainerExtensions.ViewContainersRegistry
		).registerViewContainer(
			{
				id: POSITRON_RUNTIME_VIEW_CONTAINER_ID,
				title: {
					value: nls.localize('positron.view.runtime.view', "Runtimes"),
					original: 'Runtimes'
				},
				icon: positronRuntimeSessionsViewIcon,
				order: 10,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_RUNTIME_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
				storageId: POSITRON_RUNTIME_VIEW_CONTAINER_ID,
				hideIfEmpty: true,
			},
			ViewContainerLocation.AuxiliaryBar,
			{
				doNotRegisterOpenCommand: false,
				isDefault: false
			}
		);

		// Register the Positron sessions view.
		Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
			[
				this.runtimeSessionViewDescriptor()
			],
			this._viewContainer
		);
	}

	/**
	 * Creates the view descriptor for the Positron sessions view.
	 *
	 * @returns The view descriptor for the Positron sessions view.
	 */
	private runtimeSessionViewDescriptor(): IViewDescriptor {
		const descriptor: IViewDescriptor = {
			id: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
			name: {
				value: nls.localize('positron.view.runtime.sessions', "Sessions"),
				original: 'Sessions'
			},
			ctorDescriptor: new SyncDescriptor(PositronRuntimeSessionsViewPane),
			canToggleVisibility: true,
			hideByDefault: false,
			canMoveView: true,
			containerIcon: positronRuntimeSessionsViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.toggleSessions',
				mnemonicTitle: nls.localize({ key: 'miToggleSessions', comment: ['&& denotes a mnemonic'] }, "&&Sessions"),
				order: 1,
			}
		};

		return descriptor;
	}
}

// Register workbench contributions.
const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PositronRuntimeSessionsContribution, LifecyclePhase.Restored);
