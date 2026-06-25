/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeExitReason } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { INotebookLanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IPYNB_VIEW_TYPE } from '../../notebook/browser/notebookBrowser.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellEditType, CellKind, ICellEditOperation } from '../../notebook/common/notebookCommon.js';
import { INotebookKernelService, INotebookTextModelLike } from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { ActiveRuntimeNotebookContextManager } from '../common/activeRuntimeNotebookContextManager.js';
import { registerRuntimeNotebookKernelActions } from './runtimeNotebookKernelActions.js';
import { IRuntimeNotebookKernelService } from '../common/interfaces/runtimeNotebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';
import { NotebookExecutionStatus } from './notebookExecutionStatus.js';
import { RuntimeNotebookKernel } from './runtimeNotebookKernel.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { LANGUAGE_RUNTIME_SELECT_LEGACY_NOTEBOOK_RUNTIME_ID } from '../../languageRuntime/browser/languageRuntimeActions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { isNotebookRuntimeSessionMetadata } from '../../../services/runtimeSession/common/runtimeSession.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../positronNotebook/common/positronNotebookCommon.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupIdentifier, GroupModelChangeKind } from '../../../common/editor.js';

/**
 * The service responsible for managing {@link RuntimeNotebookKernel}s.
 */
export class RuntimeNotebookKernelService extends Disposable implements IRuntimeNotebookKernelService {
	/** Map of runtime notebook kernels keyed by kernel ID. */
	private readonly _kernels = new Map<string, RuntimeNotebookKernel>();

	/** Map of runtime notebook kernels keyed by runtime ID. */
	private readonly _kernelsByRuntimeId = new Map<string, RuntimeNotebookKernel>();

	/** Map of pending kernel selections (notebook URI -> kernel ID) to start kernels that are not yet registered. */
	private readonly _pendingKernelSelections = new ResourceMap<string>();

	/**
	 * Map of Positron notebook URIs whose selected kernel hasn't been started yet,
	 * because the editor has not become active+pinned. Stored kernel is started
	 * when the editor satisfies the gate.
	 */
	private readonly _pendingPositronAutoStarts = new ResourceMap<RuntimeNotebookKernel>();

	/** Per-group EDITOR_PIN listener disposables, keyed by group ID. */
	private readonly _groupListeners = new Map<GroupIdentifier, DisposableStore>();

	/** An event that fires when code is executed in any notebook */
	private readonly _didExecuteCodeEmitter = this._register(new Emitter<ILanguageRuntimeCodeExecutedEvent>());
	onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent> = this._didExecuteCodeEmitter.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
	) {
		super();

		// Create the notebook execution status bar entry.
		this._register(this._instantiationService.createInstance(NotebookExecutionStatus));

		// Create the active runtime notebook context context manager.
		this._register(this._instantiationService.createInstance(ActiveRuntimeNotebookContextManager));

		// Create a kernel when a runtime is registered.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(async runtime => {
			const kernel = this.getOrCreateKernel(runtime);

			// Process any pending notebook selections for this kernel.
			// This handles the race condition where a notebook is created before runtimes register.
			for (const [notebookUri, kernelId] of this._pendingKernelSelections) {
				if (kernel.id === kernelId) {
					this._logService.info(
						`[RuntimeNotebookKernelService] Processing deferred kernel selection for ${kernelId}`
					);
					this._pendingKernelSelections.delete(notebookUri);
					if (this._runtimeSessionService.implicitStartupSuppressed) {
						continue;
					}
					if (this._isPositronNotebookEditorInput(notebookUri) &&
						!this._isActiveAndPinnedPositronNotebookEditor(notebookUri)) {
						this._pendingPositronAutoStarts.set(notebookUri, kernel);
						continue;
					}
					await kernel.ensureSessionStarted(notebookUri, 'Deferred kernel selection after runtime registration');
				}
			}
		}));

		// Create a kernel for each existing runtime.
		for (const runtime of this._languageRuntimeService.registeredRuntimes) {
			this.getOrCreateKernel(runtime);
		}

		// Create kernels for any restored sessions,
		// and select those kernels for any existing notebook instances.
		// This should occur before any runtimes are registered and any sessions actually started.
		this._runtimeStartupService.getRestoredSessions().then(serializedSessions => {
			const instancesByUri = new ResourceMap<IPositronNotebookInstance>();
			this._positronNotebookService.listInstances().forEach(instance => instancesByUri.set(instance.uri, instance));
			for (const session of serializedSessions) {
				if (isNotebookRuntimeSessionMetadata(session.metadata)) {
					const uri = session.metadata.notebookUri;
					const instance = instancesByUri.get(uri);
					if (instance) {
						const kernel = this.getOrCreateKernel(session.runtimeMetadata);
						this._notebookKernelService.selectKernelForNotebook(kernel, { uri, notebookType: instance.viewType });
						return;
					}
				}
			}
		});

		// When a kernel is selected for a notebook, handle starting/stopping sessions.
		this._register(this._notebookKernelService.onDidChangeSelectedNotebooks(async e => {
			// Handle deselection of our kernel
			if (isRuntimeKernelId(e.oldKernel)) {
				// Clear any pending selection for this notebook
				this._pendingKernelSelections.delete(e.notebook);
				// Drop any deferred auto-start so a stale kernel doesn't start
				// later when the editor becomes active+pinned.
				this._pendingPositronAutoStarts.delete(e.notebook);

				// Shut down the session if it was running
				const oldKernel = this._kernels.get(e.oldKernel);
				if (oldKernel) {
					await this._runtimeSessionService.shutdownNotebookSession(
						e.notebook,
						RuntimeExitReason.Shutdown,
						`Runtime kernel ${oldKernel.id} deselected for notebook`,
					);
				} else {
					this._logService.info(
						`[RuntimeNotebookKernelService] Runtime kernel ${e.oldKernel} deselected but not running. No shutdown needed.`
					);
				}
			}

			// Handle selection of our kernel
			if (isRuntimeKernelId(e.newKernel)) {
				const newKernel = this._kernels.get(e.newKernel);
				if (newKernel) {
					// Kernel is registered, start the session
					this.updateNotebookLanguage(e.notebook, newKernel.runtime.languageId);
					if (this._runtimeSessionService.implicitStartupSuppressed) {
						return;
					}
					// For Positron notebook editors, defer the session start
					// until the editor is the active+pinned editor in some
					// group. This prevents kernels from spinning up for
					// preview tabs (single-click in Explorer) and for restored
					// background tabs the user never focuses.
					if (this._isPositronNotebookEditorInput(e.notebook) &&
						!this._isActiveAndPinnedPositronNotebookEditor(e.notebook)) {
						this._pendingPositronAutoStarts.set(e.notebook, newKernel);
						return;
					}
					await newKernel.ensureSessionStarted(e.notebook, `Runtime kernel ${newKernel.id} selected for notebook`);
				} else {
					// Our kernel but not registered yet - defer processing until runtime registers
					this._logService.info(
						`[RuntimeNotebookKernelService] Runtime kernel ${e.newKernel} selected but not yet registered. Deferring.`
					);
					this._pendingKernelSelections.set(e.notebook, e.newKernel);
				}
			}
		}));

		// Ensure that a kernel is selected for added notebook documents
		this._register(this._notebookService.onWillAddNotebookDocument(notebook => {
			this.attachNotebook(notebook);
		}));

		// Ensure that a kernel is selected for all existing notebook documents
		for (const notebook of this._notebookService.getNotebookTextModels()) {
			this.attachNotebook(notebook);
		}

		// When a Positron notebook editor instance is added, attempt to start
		// its session immediately if its editor is already active+pinned
		// (e.g. user double-clicked from Explorer). Otherwise the session
		// start is deferred and triggered by the active-editor / pin
		// listeners below.
		this._register(this._positronNotebookService.onDidAddNotebookInstance(async instance => {
			await this.attachNotebookInstance(instance);
		}));

		// Note: we intentionally do NOT iterate listInstances() at startup.
		// The active-editor listener below handles the case where instances
		// already exist when this service is constructed.

		// Listen for editor activation and preview-to-pinned transitions to
		// start any deferred Positron notebook session.
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._maybeStartPendingForActiveEditor();
		}));
		this._register(this._editorGroupsService.onDidAddGroup(group => this._registerGroupListener(group)));
		this._register(this._editorGroupsService.onDidRemoveGroup(group => {
			this._groupListeners.get(group.id)?.dispose();
			this._groupListeners.delete(group.id);
		}));
		for (const group of this._editorGroupsService.groups) {
			this._registerGroupListener(group);
		}
		// Cover the case where a Positron notebook editor was already active
		// when this service was constructed.
		this._maybeStartPendingForActiveEditor();

		// When a notebook is closed, cleanup pending selections and shutdown the session.
		this._register(this._notebookService.onWillRemoveNotebookDocument(async notebook => {
			// Clean up any pending kernel selection
			this._pendingKernelSelections.delete(notebook.uri);
			this._pendingPositronAutoStarts.delete(notebook.uri);

			await this._runtimeSessionService.shutdownNotebookSession(
				notebook.uri,
				RuntimeExitReason.Shutdown,
				`Notebook closed`,
			);
		}));

		// Register kernel source action providers. This is how we customize the
		// kernel selection quickpick. Each command must return a valid runtime ID
		// (since kernel IDs have the format `${extension}/{runtimeId}`).
		this._register(this._notebookKernelService.registerKernelSourceActionProvider(IPYNB_VIEW_TYPE, {
			viewType: IPYNB_VIEW_TYPE,
			async provideKernelSourceActions() {
				return [
					{
						label: 'Select Environment...',
						command: {
							id: LANGUAGE_RUNTIME_SELECT_LEGACY_NOTEBOOK_RUNTIME_ID,
							title: 'Select Environment',
						},
					}
				];
			},
			// Kernel source actions are currently constant so we don't need this event.
			onDidChangeSourceActions: undefined,
		}));
	}

	public async ensureSessionStarted(notebookUri: URI, source: string): Promise<INotebookLanguageRuntimeSession> {
		// Get the notebook text model
		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			throw new Error(`Could not ensure session is started for notebook without text model: ${notebookUri}`);
		}
		// Get the selected kernel
		const kernel = this.getSelectedKernel(notebook);
		if (!kernel) {
			throw new Error(`Could not ensure session is started for notebook without selected kernel: ${notebookUri}`);
		}

		// Ensure the kernel has a started session
		return await kernel.ensureSessionStarted(notebook.uri, source);
	}

	public async executeCodeInCell(notebookUri: URI, cellHandle: number, code: string): Promise<void> {
		// Get the notebook text model
		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			throw new Error(`Could not execute code in cell for notebook without text model: ${notebookUri}`);
		}
		// Get the selected kernel
		const kernel = this.getSelectedKernel(notebook);
		if (!kernel) {
			throw new Error(`Could not execute code in cell for notebook without selected kernel: ${notebookUri}`);
		}

		await kernel.executeCodeInCell(notebookUri, cellHandle, code);
	}

	/**
	 * Get a runtime notebook kernel by runtime ID.
	 *
	 * @param runtimeId The runtime ID.
	 */
	public getKernelByRuntimeId(runtimeId: string): RuntimeNotebookKernel | undefined {
		return this._kernelsByRuntimeId.get(runtimeId);
	}

	/**
	 * Get the kernel for a language runtime if one exist, otherwise create and register a new one.
	 */
	private getOrCreateKernel(runtime: ILanguageRuntimeMetadata) {
		// Check if there's an existing kernel for the runtime
		const existing = this._kernelsByRuntimeId.get(runtime.runtimeId);
		if (existing) {
			return existing;
		}

		// Create the kernel instance.
		const kernel = this._register(this._instantiationService.createInstance(RuntimeNotebookKernel, runtime));

		// Warn if a kernel with the same ID already exists; that shouldn't happen.
		if (this._kernels.has(kernel.id)) {
			this._logService.warn(`Kernel with ID ${kernel.id} already exists, overwriting existing kernel`);
		}

		// Register the kernel with this service.
		this._kernels.set(kernel.id, kernel);
		this._kernelsByRuntimeId.set(runtime.runtimeId, kernel);

		// Register the kernel with the notebook kernel service.
		this._register(this._notebookKernelService.registerKernel(kernel));

		// Listen for code execution events from the kernel.
		this._register(kernel.onDidExecuteCode(e => {
			this._didExecuteCodeEmitter.fire(e);
		}));

		return kernel;
	}

	/**
	 * Update the language in a notebook's metadata and cells.
	 *
	 * @param notebookUri URI of the notebook to update.
	 * @param languageId The language ID.
	 */
	private updateNotebookLanguage(notebookUri: URI, languageId: string): void {
		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			throw new Error(`No notebook document for '${notebookUri.fsPath}'`);
		}

		// Create the edit operation to update the notebook metadata.
		const documentMetadataEdit: ICellEditOperation = {
			editType: CellEditType.DocumentMetadata,
			metadata: {
				...notebook.metadata,
				metadata: {
					...notebook.metadata.metadata ?? {},
					language_info: {
						name: languageId,
					},
				}
			},
		};

		// Create the edit operations to update the cell languages.
		const cellEdits = new Array<ICellEditOperation>();
		for (const [index, cell] of notebook.cells.entries()) {
			if (cell.cellKind === CellKind.Code &&
				cell.language !== languageId &&
				// Don't change raw cells; they're often used to define metadata e.g in Quarto notebooks.
				cell.language !== 'raw') {
				cellEdits.push({
					editType: CellEditType.CellLanguage,
					index,
					language: languageId,
				});
			}
		}

		// Skip if nothing would change, to avoid spurious DidChangeNotebookDocument
		// notifications that can disrupt language server initialization (e.g. Pyrefly).
		// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
		const existingMetadata = notebook.metadata?.metadata as any;
		const existingLanguage = existingMetadata?.language_info?.name;
		if (existingLanguage === languageId && cellEdits.length === 0) {
			return;
		}

		// Apply the edits.
		notebook.applyEdits(
			[documentMetadataEdit, ...cellEdits],
			true,
			undefined,
			() => undefined,
			undefined,
			false,
		);
	}

	/**
	 * Get the selected kernel for a notebook.
	 */
	private getSelectedKernel(notebook: INotebookTextModelLike): RuntimeNotebookKernel | undefined {
		const { selected } = this._notebookKernelService.getMatchingKernel(notebook);
		return selected && this._kernels.get(selected.id);
	}

	/**
	 * Try to determine the preferred kernel for a notebook.
	 */
	private getPreferredKernel(notebook: NotebookTextModel): RuntimeNotebookKernel | undefined {
		const languageId = getNotebookLanguage(notebook);
		if (!languageId) {
			this._logService.debug(`Could not determine notebook ${notebook.uri.fsPath} language`);
			return;
		}
		const kernel = this.kernelForLanguage(languageId);
		if (!kernel) {
			this._logService.warn(`No kernel for preferred runtime for language ${languageId} for notebook ${notebook.uri}`);
		}
		return kernel;
	}

	/**
	 * Get the selected kernel for a notebook if one is selected, otherwise select a kernel
	 * matching the preferred runtime for the notebook's language.
	 */
	private getOrSelectKernel(notebook: NotebookTextModel): RuntimeNotebookKernel | undefined {
		// If another of our kernels is already selected, nothing to do
		// e.g. the user manually selected it in a previous session
		const selectedKernel = this.getSelectedKernel(notebook);
		if (selectedKernel) {
			return selectedKernel;
		}

		// Try to get the preferred kernel for the notebook
		const preferredKernel = this.getPreferredKernel(notebook);
		if (preferredKernel) {
			// Select the preferred kernel
			this._notebookKernelService.selectKernelForNotebook(preferredKernel, notebook);
			return preferredKernel;
		}

		return;
	}

	private attachNotebook(notebook: NotebookTextModel): void {
		// If a kernel is already selected for the notebook, there's nothing to do
		if (this.getOrSelectKernel(notebook)) {
			return;
		}

		// Couldn't select a kernel, it's possible that the notebook contents are still arriving
		// e.g. `vscode.openNotebookDocument()` first creates a notebook (triggering `onWillOpenNotebookDocument`),
		// and later updates its contents (triggering `onDidChangeNotebookDocument`)
		const disposables = this._register(new DisposableStore());

		// Try again on each content change
		disposables.add(notebook.onDidChangeContent(() => {
			// Still haven't selected a kernel, try again with the updated contents
			if (this.getOrSelectKernel(notebook)) {
				disposables.dispose();
			}
		}));

		// Stop listening if one of our kernels is selected in some other way
		disposables.add(this._notebookKernelService.onDidChangeSelectedNotebooks((event) => {
			if (isEqual(event.notebook, notebook.uri) &&
				event.newKernel &&
				this._kernels.has(event.newKernel)) {
				disposables.dispose();
			}
		}));

		// Stop listening when the notebook is disposed
		disposables.add(notebook.onWillDispose(() => disposables.dispose()));
	}

	private async attachNotebookInstance(instance: IPositronNotebookInstance): Promise<void> {
		// PositronNotebookEditorInput constructs the instance synchronously and
		// fires onDidAddNotebookInstance before setInput resolves the notebook
		// text model. Wait until the model is attached to the instance before
		// applying the foreground-session fallback.
		const notebook = await this.awaitInstanceModel(instance);

		// If no kernel was resolved when the notebook was added (for example, an empty
		// .ipynb with no language metadata and no cells), fall back to the foreground
		// session's language. Doing this after the instance is constructed ensures
		// the instance's onWillStartSession subscription is in place before the
		// session start events fire.
		if (notebook && !this.getSelectedKernel(notebook)) {
			const fallback = this.kernelForLanguage(
				this._runtimeSessionService.foregroundSession?.runtimeMetadata.languageId,
			);
			if (fallback) {
				this._notebookKernelService.selectKernelForNotebook(fallback, notebook);
			}
		}

		// Get the selected kernel
		const kernel = instance.kernel.get();

		if (!kernel || this._runtimeSessionService.implicitStartupSuppressed) {
			return;
		}

		// Defer the session start until the editor is active+pinned. This is
		// the gate that prevents kernels from being created for preview tabs
		// and for backgrounded restored tabs the user never focuses.
		if (!this._isActiveAndPinnedPositronNotebookEditor(instance.uri)) {
			this._pendingPositronAutoStarts.set(instance.uri, kernel);
			return;
		}

		this._pendingPositronAutoStarts.delete(instance.uri);
		await kernel.ensureSessionStarted(instance.uri, `Positron notebook editor opened`);
	}

	private _registerGroupListener(group: IEditorGroup): void {
		if (this._groupListeners.has(group.id)) {
			return;
		}
		const disposables = new DisposableStore();
		this._groupListeners.set(group.id, disposables);
		disposables.add(group.onDidModelChange(e => {
			if (e.kind === GroupModelChangeKind.EDITOR_PIN && e.editor) {
				this._maybeStartPendingForEditor(e.editor);
			}
		}));
		disposables.add(group.onWillDispose(() => {
			disposables.dispose();
			this._groupListeners.delete(group.id);
		}));
	}

	private _maybeStartPendingForActiveEditor(): void {
		const activeEditor = this._editorService.activeEditor;
		if (!activeEditor) {
			return;
		}
		this._maybeStartPendingForEditor(activeEditor);
	}

	private _maybeStartPendingForEditor(editor: EditorInput): void {
		if (editor.typeId !== POSITRON_NOTEBOOK_EDITOR_INPUT_ID || !editor.resource) {
			return;
		}
		const uri = editor.resource;
		const pending = this._pendingPositronAutoStarts.get(uri);
		if (!pending) {
			return;
		}
		if (!this._isActiveAndPinnedPositronNotebookEditor(uri)) {
			return;
		}
		this._pendingPositronAutoStarts.delete(uri);
		pending.ensureSessionStarted(uri, `Positron notebook editor became active and pinned`)
			.catch(err => this._logService.error(`Error starting deferred notebook session: ${err}`));
	}

	private _isPositronNotebookEditorInput(uri: URI): boolean {
		const editors = this._editorService.findEditors(uri);
		return editors.some(({ editor }) => editor.typeId === POSITRON_NOTEBOOK_EDITOR_INPUT_ID);
	}

	private _isActiveAndPinnedPositronNotebookEditor(uri: URI): boolean {
		for (const group of this._editorGroupsService.groups) {
			const activeEditor = group.activeEditor;
			if (activeEditor &&
				activeEditor.typeId === POSITRON_NOTEBOOK_EDITOR_INPUT_ID &&
				activeEditor.resource &&
				isEqual(activeEditor.resource, uri) &&
				group.isPinned(activeEditor)) {
				return true;
			}
		}
		return false;
	}

	private awaitInstanceModel(instance: IPositronNotebookInstance): Promise<NotebookTextModel | undefined> {
		if (instance.textModel) {
			return Promise.resolve(instance.textModel);
		}

		return new Promise<NotebookTextModel | undefined>(resolve => {
			const disposables = this._register(new DisposableStore());
			disposables.add(instance.onDidChangeModel(() => {
				if (instance.textModel) {
					resolve(instance.textModel);
					disposables.dispose();
				}
			}));
			disposables.add(this._positronNotebookService.onDidRemoveNotebookInstance(removed => {
				if (removed === instance) {
					resolve(undefined);
					disposables.dispose();
				}
			}));
		});
	}

	private kernelForLanguage(languageId: string | undefined): RuntimeNotebookKernel | undefined {
		if (!languageId) {
			return undefined;
		}
		try {
			const runtime = this._runtimeStartupService.getPreferredRuntime(languageId);
			return runtime ? this._kernelsByRuntimeId.get(runtime.runtimeId) : undefined;
		} catch (err) {
			this._logService.debug(`No preferred runtime for language ${languageId}: ${err.toString()}`);
			return undefined;
		}
	}

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	override dispose(): void {
		for (const disposables of this._groupListeners.values()) {
			disposables.dispose();
		}
		this._groupListeners.clear();
		super.dispose();
	}

	/**
	 * Placeholder that gets called to "initialize" the service.
	 */
	initialize(): void {
	}
}

/**
 * Try to determine a notebook's language.
 *
 * @param notebook The notebook to determine the language of.
 * @returns The language ID of the notebook, or `undefined` if it could not be determined.
 */
function getNotebookLanguage(notebook: NotebookTextModel): string | undefined {
	// First try the notebook metadata.
	// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
	const metadata = notebook.metadata?.metadata as any;
	const languageId = metadata?.language_info?.name ?? metadata?.kernelspec?.language;
	if (languageId &&
		languageId !== 'raw' &&
		languageId !== 'plaintext'
	) {
		return languageId;
	}

	// Fall back to the first cell's language, if available.
	for (const cell of notebook.cells) {
		if (cell.cellKind === CellKind.Code &&
			cell.language !== 'raw' &&
			cell.language !== 'plaintext') {
			return cell.language;
		}
	}

	// Could not determine the notebook's language.
	return undefined;
}

// Register the service.
registerSingleton(
	IRuntimeNotebookKernelService,
	RuntimeNotebookKernelService,
	InstantiationType.Delayed,
);

// Register actions.
registerRuntimeNotebookKernelActions();

/**
 * Check if a kernel ID belongs to a runtime notebook kernel.
 */
function isRuntimeKernelId(kernelId: string | undefined): kernelId is string {
	return !!kernelId && kernelId.startsWith(POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);
}
