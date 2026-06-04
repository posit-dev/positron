/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { KeyMod, KeyCode, KeyChord } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { PositronVariablesFocused } from '../../../common/contextkeys.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PositronVariablesViewPane } from './positronVariablesView.js';
import { PositronVariablesRefreshAction } from './positronVariablesActions.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewDescriptorService, IViewsRegistry, ViewContainer } from '../../../common/views.js';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_COPY_AS_HTML, POSITRON_VARIABLES_COPY_AS_TEXT, POSITRON_VARIABLES_EXPAND } from './positronVariablesIdentifiers.js';
import { POSITRON_SESSION_CONTAINER, positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';

// The Positron variables view identifier.
export const POSITRON_VARIABLES_VIEW_ID = 'workbench.panel.positronVariables';

// Register the Positron variables view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_VARIABLES_VIEW_ID,
			name: {
				value: nls.localize('positron.variables', "Variables"),
				original: 'Variables'
			},
			ctorDescriptor: new SyncDescriptor(PositronVariablesViewPane),
			canToggleVisibility: true,
			canMoveView: true,
			containerIcon: positronSessionViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.toggleVariables',
				mnemonicTitle: nls.localize({ key: 'miToggleVariables', comment: ['&& denotes a mnemonic'] }, "&&Variables"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
				},
				order: 1,
			},
			focusCommand: {
				id: 'positronVariables.focus',
				keybindings: {
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyV),
				}
			}
		}
	],
	POSITRON_SESSION_CONTAINER
);

/**
 * PositronVariablesContribution class.
 */
class PositronVariablesContribution extends Disposable implements IWorkbenchContribution {
	/**
	 * Constructor.
	 * @param instantiationService The instantiation service.
	 * @param positronVariablesService The Positron variables service.
	 * @param viewDescriptorService The view descriptor service.
	 */
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
	) {
		super();
		this.registerActions();
		this._registerViewVisibilityHandler();
	}

	/**
	 * Registers actions.
	 */
	private registerActions(): void {
		registerAction2(PositronVariablesRefreshAction);
	}

	/**
	 * Registers the view visibility handler to notify the variables service
	 * when the Variables pane is explicitly hidden/shown via the "Hide View"
	 * action, or when the view is dragged into a different view container.
	 */
	private _registerViewVisibilityHandler(): void {
		// This mutable disposable tracks the listeners for the current container,
		// so we can dispose them when the container changes.
		const containerSubscriptions = this._register(new MutableDisposable<DisposableStore>());
		// Tracks whether a visibility update is already scheduled.
		// Used to consolidate multiple rapid visibility changes into a single update.
		let visibilityUpdateScheduled = false;

		// Tracks whether this contribution is still active (not disposed).
		// Used to stop a scheduled visibility update from running once the
		// variables service has been disposed.
		let active = true;
		this._register(toDisposable(() => { active = false; }));

		// Recomputes the visibility of the variables view and notifies the variables service.
		const updateVariablesViewVisibility = () => {
			visibilityUpdateScheduled = false;
			// If the contribution has been disposed, do not attempt to update the service.
			if (!active) {
				return;
			}
			// Find the container the variables view is currently in (if any)
			const container = this._viewDescriptorService.getViewContainerByViewId(POSITRON_VARIABLES_VIEW_ID);
			// The variables view is visible if it is in a container and that container considers it visible.
			const visible = !!container && this._viewDescriptorService.getViewContainerModel(container).isVisible(POSITRON_VARIABLES_VIEW_ID);
			// Notify the variables service of the current visibility.
			this._positronVariablesService.setViewVisible(visible);
		};

		// Schedules a check to see if the variables view is visible.
		const scheduleVisibilityUpdate = () => {
			if (visibilityUpdateScheduled) {
				return;
			}
			visibilityUpdateScheduled = true;

			/**
			 * When the variables view is dragged into a new container,
			 * the source container fires onDidRemoveVisibleViewDescriptors and the
			 * destination container fires onDidAddVisibleViewDescriptors back to back.
			 *
			 * If we set the variables view visibility to false on the remove event immediately,
			 * the instance and its comm will be torn down before the add event has a chance to
			 * fire which causes unnecessary teardown and setup of the variables instance.
			 *
			 * By deferring the update to the next microtask, we allow both events to be processed
			 * before we check the visibility, so we only tear down the variables instance when
			 * the view is actually hidden, not when it is moved between containers.
			 */
			queueMicrotask(updateVariablesViewVisibility);
		};

		// Attaches listeners to a container to track the visibility of the variables view within it.
		const attachToContainer = (container: ViewContainer) => {
			const model = this._viewDescriptorService.getViewContainerModel(container);
			const store = new DisposableStore();

			// Listen to the view being added to the container (e.g. via "Show View" or drag).
			store.add(model.onDidAddVisibleViewDescriptors(added => {
				if (added.some(ref => ref.viewDescriptor.id === POSITRON_VARIABLES_VIEW_ID)) {
					// The view was added to this container. Check if it is visible, and notify the service.
					scheduleVisibilityUpdate();
				}
			}));

			// Listen to the view being removed from the container (e.g. via "Hide View" or drag).
			store.add(model.onDidRemoveVisibleViewDescriptors(removed => {
				if (removed.some(ref => ref.viewDescriptor.id === POSITRON_VARIABLES_VIEW_ID)) {
					// The view was removed from this container. Check if it is still visible in another container, and notify the service.
					scheduleVisibilityUpdate();
				}
			}));

			// Track the current subscriptions so we can dispose them when the view moves to a different container.
			containerSubscriptions.value = store;

			// Schedule an initial check of the view's visibility in this container,
			// in case it changed before listeners were registered.
			scheduleVisibilityUpdate();
		};

		// Get the view container for the Variables view
		const viewContainer = this._viewDescriptorService.getViewContainerByViewId(POSITRON_VARIABLES_VIEW_ID);
		if (!viewContainer) {
			return;
		}

		// Bind listeners that checks the visibility of the variables view to the initial container.
		attachToContainer(viewContainer);

		// Make sure we re-bind these listeners whenever the variables view parent container changes.
		this._register(this._viewDescriptorService.onDidChangeContainer(e => {
			if (e.views.some(v => v.id === POSITRON_VARIABLES_VIEW_ID)) {
				attachToContainer(e.to);
			}
		}));
	}
}

// Register keybinding rule for expand.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_EXPAND,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.RightArrow,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for collapse.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COLLAPSE,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.LeftArrow,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as text.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COPY_AS_TEXT,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronVariablesFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as HTML.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COPY_AS_HTML,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register the contribution.
Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronVariablesContribution, LifecyclePhase.Restored);

// ---------------- Deferred for internal preview ----------------
// // Register the variables configuration.
// Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
// 	id: 'variables',
// 	order: 10,
// 	type: 'object',
// 	title: nls.localize('variablesConfigurationTitle', "Variables"),
// 	scope: ConfigurationScope.APPLICATION,
// 	properties: {
// 		'variables.fixedWidthFont': {
// 			type: 'boolean',
// 			default: false,
// 			scope: ConfigurationScope.APPLICATION,
// 			markdownDescription: nls.localize('variables.fixedWidthFont', "Controls whether Variables is rendered using a fixed-width font."),
// 		}
// 	}
// });

// /**
//  * Configuration options.
//  */
// export interface IVariablesOptions {
// 	/**
// 	 * Gets a value which indicates whether to render Variables with a fixed-width font.
// 	 */
// 	readonly fixedWidthFont?: boolean;
// }
