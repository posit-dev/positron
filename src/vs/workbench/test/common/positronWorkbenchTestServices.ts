/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ICommandService, ICommandEvent, CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IOpenerService, IOpener, IValidator, IExternalUriResolver, IExternalOpener, OpenInternalOptions, OpenExternalOptions, ResolveExternalUriOptions, IResolvedExternalUri } from '../../../platform/opener/common/opener.js';
import { NotebookCellTextModel } from '../../contrib/notebook/common/model/notebookCellTextModel.js';
import { INotebookTextModel } from '../../contrib/notebook/common/notebookCommon.js';
import { ICellExecutionParticipant, IDidEndNotebookCellsExecutionEvent, IDidStartNotebookCellsExecutionEvent, INotebookExecutionService } from '../../contrib/notebook/common/notebookExecutionService.js';
import { ILanguageRuntimeMetadata } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronModalDialogsService, ShowConfirmationModalDialogOptions, IModalDialogPromptInstance } from '../../services/positronModalDialogs/common/positronModalDialogs.js';
import { ILanguageRuntimeSessionManager, IRuntimeSessionMetadata, ILanguageRuntimeSession } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';

export class TestNotebookExecutionService implements INotebookExecutionService {
	declare readonly _serviceBrand: undefined;
	public readonly onDidStartNotebookCellsExecutionEmitter = new Emitter<IDidStartNotebookCellsExecutionEvent>();
	public readonly onDidEndNotebookCellsExecutionEmitter = new Emitter<IDidEndNotebookCellsExecutionEvent>();
	public readonly onDidStartNotebookCellsExecution = this.onDidStartNotebookCellsExecutionEmitter.event;
	public readonly onDidEndNotebookCellsExecution = this.onDidEndNotebookCellsExecutionEmitter.event;

	async executeNotebookCells(notebook: INotebookTextModel, cells: Iterable<NotebookCellTextModel>, contextKeyService: IContextKeyService): Promise<void> {
		throw new Error('cancelNotebookCellHandles not implemented.');
	}

	async cancelNotebookCellHandles(notebook: INotebookTextModel, cells: Iterable<number>): Promise<void> {
		throw new Error('cancelNotebookCellHandles not implemented.');
	}

	async cancelNotebookCells(notebook: INotebookTextModel, cells: Iterable<NotebookCellTextModel>): Promise<void> {
		throw new Error('cancelNotebookCells not implemented.');
	}

	registerExecutionParticipant(participant: ICellExecutionParticipant): IDisposable {
		throw new Error('registerExecutionParticipant not implemented.');
	}
}

export class TestOpenerService implements IOpenerService {
	_serviceBrand: undefined;
	registerOpener(opener: IOpener): IDisposable {
		return { dispose() { } };
	}
	registerValidator(validator: IValidator): IDisposable {
		throw new Error('Method not implemented.');
	}
	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable {
		throw new Error('Method not implemented.');
	}
	setDefaultExternalOpener(opener: IExternalOpener): void {
		throw new Error('Method not implemented.');
	}
	registerExternalOpener(opener: IExternalOpener): IDisposable {
		throw new Error('Method not implemented.');
	}
	open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
	resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri> {
		throw new Error('Method not implemented.');
	}
}

// Copied from src/vs/editor/test/browser/editorTestServices.ts for access outside of the browser context.
export class TestCommandService implements ICommandService {
	declare readonly _serviceBrand: undefined;

	private readonly _instantiationService: IInstantiationService;

	private readonly _onWillExecuteCommand = new Emitter<ICommandEvent>();
	public readonly onWillExecuteCommand: Event<ICommandEvent> = this._onWillExecuteCommand.event;

	private readonly _onDidExecuteCommand = new Emitter<ICommandEvent>();
	public readonly onDidExecuteCommand: Event<ICommandEvent> = this._onDidExecuteCommand.event;

	constructor(instantiationService: IInstantiationService) {
		this._instantiationService = instantiationService;
	}

	public executeCommand<T>(id: string, ...args: any[]): Promise<T> {
		const command = CommandsRegistry.getCommand(id);
		if (!command) {
			return Promise.reject(new Error(`command '${id}' not found`));
		}

		try {
			this._onWillExecuteCommand.fire({ commandId: id, args });
			const result = this._instantiationService.invokeFunction.apply(this._instantiationService, [command.handler, ...args]) as T;
			this._onDidExecuteCommand.fire({ commandId: id, args });
			return Promise.resolve(result);
		} catch (err) {
			return Promise.reject(err);
		}
	}
}

export class TestPositronModalDialogService implements IPositronModalDialogsService {
	_serviceBrand: undefined;
	showConfirmationModalDialog(options: ShowConfirmationModalDialogOptions): void {
		throw new Error('Method not implemented.');
	}
	showModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): IModalDialogPromptInstance {
		throw new Error('Method not implemented.');
	}
	showSimpleModalDialogPrompt(title: string, message: string, okButtonTitle?: string, cancelButtonTitle?: string): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
	showSimpleModalDialogMessage(title: string, message: string, okButtonTitle?: string): Promise<null> {
		throw new Error('Method not implemented.');
	}
}

export class TestRuntimeSessionManager implements ILanguageRuntimeSessionManager {
	public static readonly instance = new TestRuntimeSessionManager();

	private _validateMetadata?: (metadata: ILanguageRuntimeMetadata) => Promise<ILanguageRuntimeMetadata>;

	async managesRuntime(runtime: ILanguageRuntimeMetadata): Promise<boolean> {
		return true;
	}

	async createSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	async restoreSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	async validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		if (this._validateMetadata) {
			return this._validateMetadata(metadata);
		}
		return metadata;
	}

	async validateSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionId: string): Promise<boolean> {
		return true;
	}

	setValidateMetadata(handler: (metadata: ILanguageRuntimeMetadata) => Promise<ILanguageRuntimeMetadata>): void {
		this._validateMetadata = handler;
	}
}
