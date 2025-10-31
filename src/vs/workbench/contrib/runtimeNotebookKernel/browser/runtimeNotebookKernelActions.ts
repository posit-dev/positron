/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyChord, KeyCode } from '../../../../base/common/keyCodes.js';
import { isUriComponents, URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { RuntimeExitReason } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { INotebookLanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookEditorWidget } from '../../notebook/browser/notebookEditorWidget.js';
import { NOTEBOOK_KERNEL } from '../../notebook/common/notebookContextKeys.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED } from '../../positronNotebook/browser/ContextKeysManager.js';
import { checkPositronNotebookEnabled } from '../../positronNotebook/browser/positronNotebookExperimentalConfig.js';
import { usingPositronNotebooks } from '../../positronNotebook/common/positronNotebookCommon.js';
import { ActiveNotebookHasRunningRuntime, isNotebookEditorInput } from '../common/activeRuntimeNotebookContextManager.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';

const category = localize2('positron.runtimeNotebookKernel.category', "Notebook");

/** Whether a Positron kernel is selected for the active notebook. */
const NOTEBOOK_POSITRON_KERNEL_SELECTED = ContextKeyExpr.regex(NOTEBOOK_KERNEL.key, new RegExp(`${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}\/.*`));

/** The context for actions run from the VSCode notebook editor toolbar. */
interface INotebookEditorToolbarContext {
	ui: boolean;
	notebookEditor: NotebookEditorWidget;
	source: 'notebookToolbar';
}

export interface IPositronNotebookActionBarContext {
	ui: boolean;
	uri: URI;
}

function isPositronNotebookActionBarContext(obj: unknown): obj is IPositronNotebookActionBarContext {
	const context = obj as IPositronNotebookActionBarContext;
	return !!context && typeof context.ui === 'boolean' && isUriComponents(context.uri);
}

/** The context for actions in a notebook using a language runtime kernel. */
interface IRuntimeNotebookKernelActionContext {
	/** The notebook's language runtime session, if any */
	runtimeSession: INotebookLanguageRuntimeSession | undefined;
	source: {
		/** The source of the action */
		id: 'positronNotebookActionBar' | 'vscodeNotebookToolbar' | 'command';
		/** Debug message noting the source of the action */
		debugMessage: string;
	};
}

abstract class BaseRuntimeNotebookKernelAction extends Action2 {
	abstract runWithContext(accessor: ServicesAccessor, context?: IRuntimeNotebookKernelActionContext): Promise<void>;

	override async run(accessor: ServicesAccessor, context?: INotebookEditorToolbarContext | IPositronNotebookActionBarContext): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Try to use the notebook URI from the context - set if run via the notebook editor toolbar.
		let notebookUri: URI | undefined;
		let source: IRuntimeNotebookKernelActionContext['source'];
		if (context) {
			if (isPositronNotebookActionBarContext(context)) {
				source = {
					id: 'positronNotebookActionBar',
					debugMessage: 'User clicked restart button in Positron notebook editor toolbar',
				};
				notebookUri = context.uri;
			} else {
				source = {
					id: 'vscodeNotebookToolbar',
					debugMessage: 'User clicked restart button in VSCode notebook editor toolbar'
				};
				notebookUri = context.notebookEditor.textModel?.uri;
			}
		} else {
			source = {
				id: 'command',
				debugMessage: `Restart notebook kernel command ${RuntimeNotebookKernelRestartAction.ID} executed`,
			};
			const activeEditor = editorService.activeEditor;
			if (!isNotebookEditorInput(activeEditor)) {
				throw new Error('No active notebook. This command should only be available when a notebook is active.');
			}
			notebookUri = activeEditor.resource;
		}

		const runtimeSession = notebookUri && runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);

		return this.runWithContext(accessor, { runtimeSession, source });
	}
}

/** Restart the active runtime notebook kernel. */
export class RuntimeNotebookKernelRestartAction extends BaseRuntimeNotebookKernelAction {
	public static readonly ID = 'positron.runtimeNotebookKernel.restart';

	constructor() {
		super({
			id: RuntimeNotebookKernelRestartAction.ID,
			title: localize2('positron.command.restartNotebookInterpreter', 'Restart Kernel'),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			icon: Codicon.positronRestartRuntimeThin,
			f1: true,
			category,
			precondition: ContextKeyExpr.or(
				NOTEBOOK_POSITRON_KERNEL_SELECTED,  // Only set in vscode notebooks
			),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyCode.Digit0, KeyCode.Digit0),
				when: POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED,
			},
			menu: [
				// VSCode notebooks
				{
					id: MenuId.NotebookToolbar,
					group: 'navigation/execute@5',
					order: 5,
					when: NOTEBOOK_POSITRON_KERNEL_SELECTED
				},
				// Positron notebooks
				{
					id: MenuId.PositronNotebookKernelSubmenu,
					order: 10,
				}
			]
		});
	}

	override async runWithContext(accessor: ServicesAccessor, context?: IRuntimeNotebookKernelActionContext): Promise<void> {
		const session = context?.runtimeSession;
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		const configurationService = accessor.get(IConfigurationService);
		const progressService = accessor.get(IProgressService);
		const notificationService = accessor.get(INotificationService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Restart the session.
		try {
			const restart = () => runtimeSessionService.restartSession(session.metadata.sessionId, context.source.debugMessage);
			// Don't show a progress bar if using Positron notebooks
			if (checkPositronNotebookEnabled(configurationService) &&
				usingPositronNotebooks(configurationService)) {
				await restart();
			} else {
				await progressService.withProgress({
					location: ProgressLocation.Notification,
					title: localize("positron.notebook.restart.restarting", "Restarting {0} interpreter for '{1}'",
						session.runtimeMetadata.runtimeName, session.metadata.notebookUri.fsPath),
				}, restart);
			}
		} catch (error) {
			notificationService.error(
				localize("positron.notebook.restart.failed", "Restarting {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.runtimeName, session.metadata.notebookUri.fsPath, error.message));
		}
	}
}

/** Shutdown the active runtime notebook kernel. */
export class RuntimeNotebookKernelShutdownAction extends BaseRuntimeNotebookKernelAction {
	public static readonly ID = 'positron.runtimeNotebookKernel.shutdown';

	constructor() {
		super({
			id: RuntimeNotebookKernelShutdownAction.ID,
			title: localize2('positron.command.shutdownNotebookInterpreter', 'Shutdown Kernel'),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			icon: Codicon.positronPowerButtonThin,
			f1: true,
			category,
			precondition: ActiveNotebookHasRunningRuntime,
			menu: [
				// Positron notebooks
				{
					id: MenuId.PositronNotebookKernelSubmenu,
					order: 20,
				}
			]
		});
	}

	override async runWithContext(accessor: ServicesAccessor, context?: IRuntimeNotebookKernelActionContext): Promise<void> {
		const session = context?.runtimeSession;
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		const configurationService = accessor.get(IConfigurationService);
		const progressService = accessor.get(IProgressService);
		const notificationService = accessor.get(INotificationService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Shutdown the session.
		try {
			const shutdown = () => runtimeSessionService.shutdownNotebookSession(session.metadata.notebookUri, RuntimeExitReason.Shutdown, context.source.debugMessage);
			// Don't show a progress bar if using Positron notebooks
			if (checkPositronNotebookEnabled(configurationService) &&
				usingPositronNotebooks(configurationService)) {
				await shutdown();
			} else {
				await progressService.withProgress({
					location: ProgressLocation.Notification,
					title: localize("positron.notebook.shutdown.shuttingDown", "Shutting down {0} interpreter for '{1}'",
						session.runtimeMetadata.runtimeName, session.metadata.notebookUri.fsPath),
				}, shutdown);
			}
		} catch (error) {
			notificationService.error(
				localize("positron.notebook.shutdown.failed", "Shutting down {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.runtimeName, session.metadata.notebookUri.fsPath, error.message));
		}
	}
}

export function registerRuntimeNotebookKernelActions(): void {
	registerAction2(RuntimeNotebookKernelRestartAction);
	registerAction2(RuntimeNotebookKernelShutdownAction);
}
