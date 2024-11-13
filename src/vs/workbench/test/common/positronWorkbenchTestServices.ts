/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICommandService, ICommandEvent, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService, IOpener, IValidator, IExternalUriResolver, IExternalOpener, OpenInternalOptions, OpenExternalOptions, ResolveExternalUriOptions, IResolvedExternalUri } from 'vs/platform/opener/common/opener';
import { INotebookRendererInfo, INotebookStaticPreloadInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronModalDialogsService, ShowConfirmationModalDialogOptions, IModalDialogPromptInstance } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { ILanguageRuntimeSessionManager, IRuntimeSessionMetadata, ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';

export class TestNotebookService implements Partial<INotebookService> {
	getRenderers(): INotebookRendererInfo[] {
		return [];
	}

	getPreferredRenderer(_mimeType: string): NotebookOutputRendererInfo | undefined {
		return <NotebookOutputRendererInfo>{
			id: 'positron-ipywidgets',
			extensionId: new ExtensionIdentifier('vscode.positron-ipywidgets'),
		};
	}

	*getStaticPreloads(_viewType: string): Iterable<INotebookStaticPreloadInfo> {
		// Yield nothing.
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
	async managesRuntime(runtime: ILanguageRuntimeMetadata): Promise<boolean> {
		return true;
	}

	async createSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	async restoreSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		throw new Error('Method not implemented');
	}
}
