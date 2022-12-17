/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILanguageRuntime, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, IRuntimeClientInstance, RuntimeClientType, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

export class MockLanguageRuntime extends Disposable implements ILanguageRuntime {
	// The runtime state.
	private _runtimeState = RuntimeState.Uninitialized;

	// The onDidReceiveRuntimeMessage event.
	private _onDidReceiveRuntimeMessage = this._register(new Emitter<ILanguageRuntimeMessage>());
	readonly onDidReceiveRuntimeMessage: Event<ILanguageRuntimeMessage> = this._onDidReceiveRuntimeMessage.event;

	// The onDidChangeRuntimeState event.
	private _onDidChangeRuntimeState = this._register(new Emitter<RuntimeState>());
	readonly onDidChangeRuntimeState: Event<RuntimeState> = this._onDidChangeRuntimeState.event;

	// The onDidCompleteStartup event.
	private _onDidCompleteStartup = this._register(new Emitter<ILanguageRuntimeInfo>());
	readonly onDidCompleteStartup: Event<ILanguageRuntimeInfo> = this._onDidCompleteStartup.event;

	/**
	 * Constructor.
	 */
	constructor(readonly _metadata: ILanguageRuntimeMetadata) {
		// Initialize base disposable functionality
		super();

		// Set the metadata.
		this.metadata = _metadata;
	}

	/**
	 * Create a new client widget instance (not supported by the mock runtime)
	 */
	createClient(type: RuntimeClientType): Thenable<IRuntimeClientInstance> {
		throw new Error('Method not implemented.');
	}

	/**
	 * Create a new client widget instance (not supported by the mock runtime)
	 */
	listClients(): Thenable<IRuntimeClientInstance[]> {
		throw new Error('Method not implemented.');
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();
	}

	/**
	 * Gets the metadata for the language runtime.
	 */
	readonly metadata;

	/**
	 * Gets the current state of the mock language runtime.
	 * @returns The current state of the mock language runtime.
	 */
	getRuntimeState(): RuntimeState {
		return this._runtimeState;
	}

	/**
	 * Executes code in the runtime.
	 * @param code The code to execute.
	 * @param id The ID of the operation.
	 * @returns The result of the execution.
	 */
	async execute(code: string, id: string): Promise<string> {
		return 'Error. This is a mock language runtime, so it cannot execute code.';
	}

	/**
	 *
	 * @param id
	 * @param value
	 */
	replyToPrompt(id: string, value: string): void {
		throw new Error('Method not implemented.');
	}

	/**
	 * Starts
	 * @returns
	 */
	start(): Promise<ILanguageRuntimeInfo> {
		return Promise.resolve({
			banner: '',
			language_version: this._metadata.version,
			implementation_version: '1.0',
		} as ILanguageRuntimeInfo);
	}

	/**
	 *
	 */
	interrupt(): void {
		throw new Error('Method not implemented.');
	}

	/**
	 *
	 */
	restart(): void {
		throw new Error('Method not implemented.');
	}

	/**
	 *
	 */
	shutdown(): void {
		throw new Error('Method not implemented.');
	}
}
