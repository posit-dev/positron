/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
import { NotebookExecutionStatus } from './notebookExecutionStatus.js';
import { RuntimeNotebookKernel } from './runtimeNotebookKernel.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { LANGUAGE_RUNTIME_SELECT_RUNTIME_ID } from '../../languageRuntime/browser/languageRuntimeActions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { isNotebookRuntimeSessionMetadata } from '../../../services/runtimeSession/common/runtimeSession.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IPositronNotebookInstance } from '../../positronNotebook/browser/IPositronNotebookInstance.js';

/**
 * The service responsible for managing {@link RuntimeNotebookKernel}s.
 */
export class RuntimeNotebookKernelService extends Disposable implements IRuntimeNotebookKernelService {
	/** Map of runtime notebook kernels keyed by kernel ID. */
	private readonly _kernels = new Map<string, RuntimeNotebookKernel>();

	/** Map of runtime notebook kernels keyed by runtime ID. */
	private readonly _kernelsByRuntimeId = new Map<string, RuntimeNotebookKernel>();

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
	) {
		super();

		// Create the notebook execution status bar entry.
		this._register(this._instantiationService.createInstance(NotebookExecutionStatus));

		// Create the active runtime notebook context context manager.
		this._register(this._instantiationService.createInstance(ActiveRuntimeNotebookContextManager));

		// Create a kernel when a runtime is registered.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this.getOrCreateKernel(runtime);
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

		// When a known kernel is selected for a notebook, select the corresponding runtime.
		this._register(this._notebookKernelService.onDidChangeSelectedNotebooks(async e => {
			// Get the old/new kernel from the map.
			// These will be undefined if the user switched from/to an unknown kernel.
			const oldKernel = e.oldKernel && this._kernels.get(e.oldKernel);
			const newKernel = e.newKernel && this._kernels.get(e.newKernel);
			if (newKernel) {
				// A known kernel was selected.
				// Update the notebook's language to match the selected kernel.
				this.updateNotebookLanguage(e.notebook, newKernel.runtime.languageId);

				// Select the corresponding runtime for the notebook.
				// This will also shutdown the old runtime if needed.
				await newKernel.ensureSessionStarted(
					e.notebook,
					`Runtime kernel ${newKernel.id} selected for notebook`,
				);
			} else if (oldKernel && !newKernel) {
				// The user switched from a known kernel to an unknown kernel, shutdown the old kernel's runtime.
				await this._runtimeSessionService.shutdownNotebookSession(
					e.notebook,
					RuntimeExitReason.Shutdown,
					`Runtime kernel ${oldKernel.id} deselected for notebook`,
				);
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

		// When a notebook is closed, shutdown the corresponding session.
		this._register(this._notebookService.onWillRemoveNotebookDocument(async notebook => {
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
							id: LANGUAGE_RUNTIME_SELECT_RUNTIME_ID,
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
		// Get the notebook's language.
		const languageId = getNotebookLanguage(notebook);
		if (!languageId) {
			this._logService.debug(`Could not determine notebook ${notebook.uri.fsPath} language`);
			return;
		}

		// Get the preferred runtime for the notebook's language.
		let runtime: ILanguageRuntimeMetadata | undefined;
		try {
			runtime = this._runtimeStartupService.getPreferredRuntime(languageId);
			this._logService.debug(`No preferred runtime for language ${languageId}`);
		} catch (err) {
			// It may error if there are no registered runtimes for the language, so log and return.
			this._logService.debug(`Failed to get preferred runtime for language ${languageId}. Reason: ${err.toString()}`);
			return;
		}

		// Get the preferred runtime's matching kernel.
		if (runtime) {
			const kernel = this._kernelsByRuntimeId.get(runtime.runtimeId);
			if (kernel) {
				return kernel;
			} else {
				this._logService.warn(`No kernel for preferred runtime ${runtime.runtimeId} for notebook ${notebook.uri}`);
			}
		}

		return;
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

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

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
