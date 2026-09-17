/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderWorkspaceService } from '../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { WorkspaceService } from '../../../services/configuration/browser/configurationService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ITextEditorService } from '../../../services/textfile/common/textEditorService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IWorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackup.js';
import { WorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackupService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';
import { IPositronCanvasService } from './positronCanvasService.js';

let switching = false;
const STARTING_MESSAGE = localize('canvasStartingInWorkspace', "Canvas is starting in new workspace");

function createCurtain(container: HTMLElement): { element: HTMLElement; message: HTMLElement; spinner: HTMLElement } {
	const element = container.ownerDocument.createElement('div');
	element.style.cssText = 'position:absolute;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:14px var(--vscode-font-family);';
	const message = container.ownerDocument.createElement('div');
	message.setAttribute('role', 'status');
	message.textContent = STARTING_MESSAGE;
	const spinner = container.ownerDocument.createElement('div');
	spinner.className = 'positron-canvas-startup-spinner';
	spinner.setAttribute('aria-hidden', 'true');
	if (container.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		spinner.style.animation = 'none';
	}
	element.append(spinner, message);
	container.appendChild(element);
	return { element, message, spinner };
}

class SwitchCanvasFolderPrototype extends Action2 {
	constructor() {
		super({
			id: 'positron.experimental.switchCanvasFolder', title: localize2('canvas.switchFolderPrototype', 'Switch Canvas Folder (Prototype)'), f1: true, precondition: PositronCanvasModeActiveContext,
			keybinding: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyO, weight: KeybindingWeight.WorkbenchContrib + 60 }
		});
	}

	override async run(accessor: ServicesAccessor, folderPath?: string): Promise<void> {
		if (switching) {
			return;
		}
		switching = true;
		try {
			await this.switchFolder(accessor, folderPath);
		} finally {
			switching = false;
		}
	}

	private async switchFolder(accessor: ServicesAccessor, folderPath?: string): Promise<void> {
		const canvas = accessor.get(IPositronCanvasService);
		const context = accessor.get(IWorkspaceContextService) as WorkspaceService;
		const environment = accessor.get(INativeWorkbenchEnvironmentService);
		const groups = accessor.get(IEditorGroupsService);
		const textEditors = accessor.get(ITextEditorService);
		const auxiliary = accessor.get(IAuxiliaryWindowService);
		const extensions = accessor.get(IExtensionService);
		const commands = accessor.get(ICommandService);
		const runtimes = accessor.get(IRuntimeSessionService);
		const storage = accessor.get(IStorageService);
		const backups = accessor.get(IWorkingCopyBackupService);
		const workingCopies = accessor.get(IWorkingCopyService);
		const trust = accessor.get(IWorkspaceTrustManagementService);
		const files = accessor.get(IFileService);
		const dialogs = accessor.get(IFileDialogService);
		const recents = accessor.get(IWorkspacesService);
		const native = accessor.get(INativeHostService);
		const folderService = ProxyChannel.toService<ICanvasFolderWorkspaceService>(accessor.get(IMainProcessService).getChannel('workspaces'), { context: native.windowId });

		if (!canvas.isActive || environment.remoteAuthority || context.getWorkbenchState() !== WorkbenchState.FOLDER) {
			throw new Error('The prototype requires Canvas in a local single-folder workspace.');
		}
		const source = context.getWorkspace().folders[0].uri;
		const target = folderPath ? URI.file(folderPath) : (await dialogs.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: source, title: 'Open Canvas workspace' }))?.[0];
		if (!target || target.toString() === source.toString()) {
			return;
		}
		if (target.scheme !== Schemas.file || !(await files.stat(target)).isDirectory) {
			throw new Error('Select a local folder.');
		}
		if (!trust.isWorkspaceTrusted() || !(await trust.getUriTrustInfo(target)).trusted) {
			throw new Error('The prototype only switches between already-trusted folders.');
		}
		if (workingCopies.hasDirty) {
			throw new Error('Save or discard unsaved changes before using the prototype.');
		}
		const group = canvas.activeGroup;
		const previous = group?.editors.find(editor => editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE);
		const findCanvas = () => [group, ...groups.groups.filter(candidate => candidate !== group)].flatMap(group => group?.editors.map(editor => ({ group, editor })) ?? []).find(({ editor }) => editor !== previous && !editor.isDisposed() && editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE);
		const part = group && groups.getPart(group);
		const window = part && auxiliary.getWindow(part.windowId);
		if (!group || !window || !previous) {
			throw new Error('Canvas must be in its standalone window.');
		}

		const curtain = createCurtain(window.container);
		let placeholder: EditorInput | undefined;
		let stopped = false;
		const restoreCanvas = async () => {
			curtain.message.textContent = STARTING_MESSAGE;
			curtain.spinner.hidden = false;
			if (stopped) {
				await extensions.startExtensionHosts();
				stopped = false;
			}
			group.focus();
			const wasLocked = group.isLocked;
			let ready: boolean | undefined;
			// Let ViewColumn.Active target Canvas without a second webview move.
			group.lock(false);
			try {
				ready = await raceTimeout(commands.executeCommand('posit-assistant.ensureCanvas').then(() => true), 30_000);
			} finally {
				group.lock(wasLocked);
			}
			if (!ready) {
				throw new Error('Canvas did not finish starting.');
			}
			const next = findCanvas();
			if (!next || (next.group !== group && !next.group.moveEditors(prepareMoveCopyEditors(next.group, [next.editor]), group))) {
				throw new Error('Canvas could not return to its window.');
			}
			await group.openEditor(next.editor, { pinned: true, preserveFocus: true });
			if (placeholder) {
				await group.closeEditor(placeholder, { preserveFocus: true });
			}
			storage.store(CANVAS_MODE_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			curtain.element.remove();
			group.focus();
		};
		try {
			// Keep the auxiliary editor part alive while its webview is replaced.
			placeholder = textEditors.createTextEditor({ resource: URI.from({ scheme: Schemas.untitled, path: 'Canvas workspace transition' }) });
			await group.openEditor(placeholder, { pinned: true, preserveFocus: true });
			if (!group.contains(placeholder)) {
				throw new Error('Could not prepare the Canvas window.');
			}
			await group.closeEditor(previous, { preserveFocus: true });
			for (const session of [...runtimes.activeSessions]) {
				if (!await runtimes.deleteSession(session.sessionId)) {
					throw new Error('Runtime shutdown was cancelled.');
				}
			}
			stopped = await extensions.stopExtensionHosts('Switching Canvas workspace');
			if (!stopped) {
				throw new Error('Extension shutdown was cancelled.');
			}
			const result = await folderService.enterCanvasFolder(target);
			await context.initialize(result.workspace);
			await storage.switch(result.workspace, false);
			if (backups instanceof WorkingCopyBackupService) {
				backups.reinitialize(result.backupPath ? URI.file(result.backupPath).with({ scheme: environment.userRoamingDataHome.scheme }) : undefined);
			}
			await recents.addRecentlyOpened([{ folderUri: result.workspace.uri }]);
			await extensions.startExtensionHosts();
			stopped = false;
			await restoreCanvas();
		} catch (error) {
			curtain.spinner.hidden = true;
			curtain.message.textContent = `Workspace switch stopped: ${error instanceof Error ? error.message : String(error)}`;
			for (const [label, action] of [
				['Retry Canvas', restoreCanvas],
				['Open Positron', async () => { await canvas.exit(); curtain.element.remove(); }]
			] as const) {
				const button = window.window.document.createElement('button');
				button.textContent = label;
				button.onclick = () => { void action().catch(cause => { curtain.spinner.hidden = true; curtain.message.textContent = String(cause); }); };
				curtain.element.appendChild(button);
			}
		}
	}
}

registerAction2(SwitchCanvasFolderPrototype);

CommandsRegistry.registerCommand('positron.experimental.getCanvasFolders', async accessor => {
	const recents = await accessor.get(IWorkspacesService).getRecentlyOpened();
	return recents.workspaces.filter(isRecentFolder).filter(entry => entry.folderUri.scheme === Schemas.file).map(entry => entry.folderUri.fsPath);
});
