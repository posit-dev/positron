/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { createServices, ServiceIdCtorPair, TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IOpener, IOpenerService } from 'vs/platform/opener/common/opener';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { LanguageService } from 'vs/editor/common/services/languageService';
import { ILanguageRuntimeGlobalEvent, ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { TestExtensionService, TestStorageService, TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { RuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSession';
import { IModalDialogPromptInstance, IPositronModalDialogsService, ShowConfirmationModalDialogOptions } from 'vs/workbench/services/positronModalDialogs/common/positronModalDialogs';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { CommandsRegistry, ICommandEvent, ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MockKeybindingService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class TestRuntimeSessionService extends Disposable implements Partial<IRuntimeSessionService> {
	private readonly _willStartEmitter = this._register(new Emitter<IRuntimeSessionWillStartEvent>());
	private readonly _didStartRuntime = this._register(new Emitter<ILanguageRuntimeSession>());
	private readonly _didReceiveRuntimeEvent = this._register(new Emitter<ILanguageRuntimeGlobalEvent>());
	private readonly _didCreateClientInstance = this._register(new Emitter<ILanguageRuntimeClientCreatedEvent>());

	readonly activeSessions = new Array<ILanguageRuntimeSession>();

	readonly onWillStartSession = this._willStartEmitter.event;

	readonly onDidStartRuntime = this._didStartRuntime.event;

	readonly onDidReceiveRuntimeEvent = this._didReceiveRuntimeEvent.event;

	readonly onDidCreateClientInstance = this._didCreateClientInstance.event;

	// Test helpers.

	startSession(session: ILanguageRuntimeSession): void {
		this.activeSessions.push(session);
		this._register(session.onDidCreateClientInstance(e => this._didCreateClientInstance.fire(e)));
		this._willStartEmitter.fire({ session, isNew: true });
		this._didStartRuntime.fire(session);
	}
}

class TestOpenerService implements Partial<IOpenerService> {
	registerOpener(opener: IOpener): IDisposable {
		return { dispose() { } };
	}
}

// Copied from src/vs/editor/test/browser/editorTestServices.ts
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

class TestPositronModalDialogService implements IPositronModalDialogsService {
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

export function createRuntimeServices(
	disposables: DisposableStore, services: ServiceIdCtorPair<any>[] = [],
): TestInstantiationService {
	return createServices(disposables, services.concat([
		[IOpenerService, TestOpenerService],
		[ILanguageService, LanguageService],
		[IExtensionService, TestExtensionService],
		[IStorageService, TestStorageService],
		[ILogService, NullLogService],
		[IWorkspaceTrustManagementService, TestWorkspaceTrustManagementService],
		[ILanguageRuntimeService, LanguageRuntimeService],
		[IPositronModalDialogsService, TestPositronModalDialogService],
		[IConfigurationService, TestConfigurationService],
		[ICommandService, TestCommandService],
		// [ILayoutService, TestLayoutService],
		[IKeybindingService, MockKeybindingService],
		[IRuntimeSessionService, RuntimeSessionService],
	]));
}
