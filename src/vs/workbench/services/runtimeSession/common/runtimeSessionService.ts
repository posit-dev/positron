/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, ILanguageRuntimeSessionState, RuntimeState, ILanguageRuntimeInfo, ILanguageRuntimeStartupFailure, ILanguageRuntimeExit, ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageStream, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageError, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeCodeFragmentStatus, RuntimeExitReason } from '../../languageRuntime/common/languageRuntimeService';
import { RuntimeClientType, IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeUiClient';

export const IRuntimeSessionService = createDecorator<IRuntimeSessionService>('languageRuntimeService');

/**
 * The main interface for interacting with a language runtime session.
 */

export interface ILanguageRuntimeSession {
	/** The language runtime's static metadata */
	readonly metadata: ILanguageRuntimeMetadata;

	/** The unique identifier of the session */
	readonly sessionId: string;

	/** A user-friendly name for the session */
	readonly sessionName: string;

	/** The session mode */
	readonly sessionMode: LanguageRuntimeSessionMode;

	/** The language runtime's dynamic metadata */
	dynState: ILanguageRuntimeSessionState;

	/** An object that emits events when the runtime state changes */
	onDidChangeRuntimeState: Event<RuntimeState>;

	/** An object that emits an event when the runtime completes startup */
	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	/** An object that emits an event when runtime startup fails */
	onDidEncounterStartupFailure: Event<ILanguageRuntimeStartupFailure>;

	/** An object that emits an event when the runtime exits */
	onDidEndSession: Event<ILanguageRuntimeExit>;

	/**
	 * An object that emits an event when a client instance (comm) is created
	 * from the runtime side. Note that this only fires when an instance is
	 * created from the runtime side; it does not fire when
	 * `createClient` is called from the front end.
	 */
	onDidCreateClientInstance: Event<ILanguageRuntimeClientCreatedEvent>;

	onDidReceiveRuntimeMessageOutput: Event<ILanguageRuntimeMessageOutput>;
	onDidReceiveRuntimeMessageStream: Event<ILanguageRuntimeMessageStream>;
	onDidReceiveRuntimeMessageInput: Event<ILanguageRuntimeMessageInput>;
	onDidReceiveRuntimeMessageError: Event<ILanguageRuntimeMessageError>;
	onDidReceiveRuntimeMessagePrompt: Event<ILanguageRuntimeMessagePrompt>;
	onDidReceiveRuntimeMessageState: Event<ILanguageRuntimeMessageState>;
	onDidReceiveRuntimeClientEvent: Event<IRuntimeClientEvent>;
	onDidReceiveRuntimeMessagePromptConfig: Event<void>;

	/** The current state of the runtime (tracks events above) */
	getRuntimeState(): RuntimeState;

	/**
	 * Opens a resource in the runtime.
	 * @param resource The resource to open.
	 * @returns true if the resource was opened; otherwise, false.
	 */
	openResource(resource: URI | string): Thenable<boolean>;

	/** Execute code in the runtime */
	execute(code: string,
		id: string,
		mode: RuntimeCodeExecutionMode,
		errorBehavior: RuntimeErrorBehavior): void;

	/** Test a code fragment for completeness */
	isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus>;

	/**
	 * Create a new instance of a client; return null if the client type
	 * is not supported by this runtime.
	 *
	 * @param type The type of client to create
	 * @param params The parameters to pass to the client constructor
	 */
	createClient<T, U>(type: RuntimeClientType, params: any): Thenable<IRuntimeClientInstance<T, U>>;

	/** Get a list of all known clients */
	listClients(type?: RuntimeClientType): Thenable<Array<IRuntimeClientInstance<any, any>>>;

	/** Reply to an input prompt that the runtime issued
	 * (via a LanguageRuntimePrompt message)
	 */
	replyToPrompt(id: string, value: string): void;

	start(): Thenable<ILanguageRuntimeInfo>;

	/** Interrupt the runtime */
	interrupt(): void;

	/** Restart the runtime */
	restart(): Thenable<void>;

	/** Shut down the runtime */
	shutdown(exitReason?: RuntimeExitReason): Thenable<void>;

	/** Force quit the runtime */
	forceQuit(): Thenable<void>;

	/** Show output log of the runtime */
	showOutput(): void;
}

export interface IRuntimeSessionService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

}

export { RuntimeClientType, IRuntimeClientInstance };
