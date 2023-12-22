/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	ExtHostLanguageRuntimeShape,
	MainThreadLanguageRuntimeShape,
	MainPositronContext,
	ExtHostPositronContext
} from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ILanguageRuntime, ILanguageRuntimeClientCreatedEvent, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageCommClosed, ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen, ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeDynState as ILanguageRuntimeDynState, ILanguageRuntimeService, ILanguageRuntimeStartupFailure, LanguageRuntimeMessageType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, LanguageRuntimeDiscoveryPhase, ILanguageRuntimeExit, RuntimeOutputKind, RuntimeExitReason, ILanguageRuntimeMessageWebOutput, PositronOutputLocation } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { ILogService } from 'vs/platform/log/common/log';
import { IRuntimeClientInstance, RuntimeClientState, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { DeferredPromise } from 'vs/base/common/async';
import { generateUuid } from 'vs/base/common/uuid';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IPositronIPyWidgetsService, MIME_TYPE_WIDGET_STATE, MIME_TYPE_WIDGET_VIEW } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IPositronHelpService } from 'vs/workbench/contrib/positronHelp/browser/positronHelpService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IRuntimeClientEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeFrontEndClient';
import { URI } from 'vs/base/common/uri';
import { BusyEvent, FrontendEvent, PromptStateEvent, WorkingDirectoryEvent } from 'vs/workbench/services/languageRuntime/common/positronFrontendComm';

/**
 * Represents a language runtime event (for example a message or state change)
 * that is queued for delivery.
 */
abstract class QueuedRuntimeEvent {
	/**
	 * Create a new queued runtime event.
	 *
	 * @param clock The Lamport clock value for the event
	 */
	constructor(readonly clock: number) { }
	abstract summary(): string;
}

/**
 * Represents a language runtime message event.
 */
class QueuedRuntimeMessageEvent extends QueuedRuntimeEvent {
	override summary(): string {
		return `${this.message.type}`;
	}

	constructor(clock: number, readonly message: ILanguageRuntimeMessage) {
		super(clock);
	}
}

/**
 * Represents a language runtime state change event.
 */
class QueuedRuntimeStateEvent extends QueuedRuntimeEvent {
	override summary(): string {
		return `=> ${this.state}`;
	}
	constructor(clock: number, readonly state: RuntimeState) {
		super(clock);
	}
}

// Adapter class; presents an ILanguageRuntime interface that connects to the
// extension host proxy to supply language features.
class ExtHostLanguageRuntimeAdapter implements ILanguageRuntime {

	private readonly _stateEmitter = new Emitter<RuntimeState>();
	private readonly _startupEmitter = new Emitter<ILanguageRuntimeInfo>();
	private readonly _startupFailureEmitter = new Emitter<ILanguageRuntimeStartupFailure>();
	private readonly _exitEmitter = new Emitter<ILanguageRuntimeExit>();

	private readonly _onDidReceiveRuntimeMessageOutputEmitter = new Emitter<ILanguageRuntimeMessageOutput>();
	private readonly _onDidReceiveRuntimeMessageStreamEmitter = new Emitter<ILanguageRuntimeMessageStream>();
	private readonly _onDidReceiveRuntimeMessageInputEmitter = new Emitter<ILanguageRuntimeMessageInput>();
	private readonly _onDidReceiveRuntimeMessageErrorEmitter = new Emitter<ILanguageRuntimeMessageError>();
	private readonly _onDidReceiveRuntimeMessagePromptEmitter = new Emitter<ILanguageRuntimeMessagePrompt>();
	private readonly _onDidReceiveRuntimeMessageStateEmitter = new Emitter<ILanguageRuntimeMessageState>();
	private readonly _onDidReceiveRuntimeMessageClientEventEmitter = new Emitter<IRuntimeClientEvent>();
	private readonly _onDidReceiveRuntimeMessagePromptConfigEmitter = new Emitter<void>();
	private readonly _onDidCreateClientInstanceEmitter = new Emitter<ILanguageRuntimeClientCreatedEvent>();

	private _currentState: RuntimeState = RuntimeState.Uninitialized;
	private _clients: Map<string, ExtHostRuntimeClientInstance<any, any>> =
		new Map<string, ExtHostRuntimeClientInstance<any, any>>();

	/** Lamport clock, used for event ordering */
	private _eventClock = 0;

	/** Queue of language runtime events that need to be delivered */
	private _eventQueue: QueuedRuntimeEvent[] = [];

	/** Timer used to ensure event queue processing occurs within a set interval */
	private _eventQueueTimer: NodeJS.Timeout | undefined;

	constructor(
		readonly handle: number,
		readonly metadata: ILanguageRuntimeMetadata,
		readonly dynState: ILanguageRuntimeDynState,
		private readonly _languageRuntimeService: ILanguageRuntimeService,
		private readonly _logService: ILogService,
		private readonly _notebookService: INotebookService,
		private readonly _proxy: ExtHostLanguageRuntimeShape) {

		// Bind events to emitters
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidCompleteStartup = this._startupEmitter.event;
		this.onDidEncounterStartupFailure = this._startupFailureEmitter.event;
		this.onDidEndSession = this._exitEmitter.event;

		// Listen to state changes and track the current state
		this.onDidChangeRuntimeState((state) => {
			this._currentState = state;

			if (state === RuntimeState.Exited) {

				// When the runtime exits, check for any clients that still
				// think they're connected, and notify them that they are now
				// closed.
				for (const client of this._clients.values()) {
					if (client.getClientState() === RuntimeClientState.Connected) {
						client.setClientState(RuntimeClientState.Closing);
						client.setClientState(RuntimeClientState.Closed);
						client.dispose();
					}
				}

				// Remove all clients; none can send or receive data any more
				this._clients.clear();
			}
		});

		this._languageRuntimeService.onDidReceiveRuntimeEvent(globalEvent => {
			// Ignore events for other runtimes.
			if (globalEvent.runtime_id !== this.metadata.runtimeId) {
				return;
			}

			const ev = globalEvent.event;
			if (ev.name === FrontendEvent.PromptState) {
				// Update config before propagating event
				const state = ev.data as PromptStateEvent;

				// Runtimes might supply prompts with trailing whitespace (e.g. R,
				// Python) that we trim here because we add our own whitespace later on
				const inputPrompt = state.input_prompt?.trimEnd();
				const continuationPrompt = state.continuation_prompt?.trimEnd();

				if (inputPrompt) {
					this.dynState.inputPrompt = inputPrompt;
				}
				if (continuationPrompt) {
					this.dynState.continuationPrompt = continuationPrompt;
				}

				// Don't include new state in event, clients should
				// inspect the runtime's dyn state instead
				this.emitDidReceiveRuntimeMessagePromptConfig();
			} else if (ev.name === FrontendEvent.Busy) {
				// Update busy state
				const busy = ev.data as BusyEvent;
				this.dynState.busy = busy.busy;
			} else if (ev.name === FrontendEvent.WorkingDirectory) {
				// Update current working directory
				const dir = ev.data as WorkingDirectoryEvent;
				this.dynState.currentWorkingDirectory = dir.directory;
			}

			// Propagate event
			this._onDidReceiveRuntimeMessageClientEventEmitter.fire(ev);
		});
	}

	onDidChangeRuntimeState: Event<RuntimeState>;

	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	onDidEncounterStartupFailure: Event<ILanguageRuntimeStartupFailure>;

	onDidEndSession: Event<ILanguageRuntimeExit>;

	onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutputEmitter.event;
	onDidReceiveRuntimeMessageStream = this._onDidReceiveRuntimeMessageStreamEmitter.event;
	onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInputEmitter.event;
	onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageErrorEmitter.event;
	onDidReceiveRuntimeMessagePrompt = this._onDidReceiveRuntimeMessagePromptEmitter.event;
	onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageStateEmitter.event;
	onDidReceiveRuntimeClientEvent = this._onDidReceiveRuntimeMessageClientEventEmitter.event;
	onDidReceiveRuntimeMessagePromptConfig = this._onDidReceiveRuntimeMessagePromptConfigEmitter.event;
	onDidCreateClientInstance = this._onDidCreateClientInstanceEmitter.event;

	handleRuntimeMessage(message: ILanguageRuntimeMessage): void {
		// Add the message to the event queue
		const event = new QueuedRuntimeMessageEvent(message.event_clock, message);
		this.addToEventQueue(event);
	}

	emitDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput: ILanguageRuntimeMessageOutput) {
		this._onDidReceiveRuntimeMessageOutputEmitter.fire(languageRuntimeMessageOutput);
	}

	emitDidReceiveRuntimeMessageStream(languageRuntimeMessageStream: ILanguageRuntimeMessageStream) {
		this._onDidReceiveRuntimeMessageStreamEmitter.fire(languageRuntimeMessageStream);
	}

	emitDidReceiveRuntimeMessageInput(languageRuntimeMessageInput: ILanguageRuntimeMessageInput) {
		this._onDidReceiveRuntimeMessageInputEmitter.fire(languageRuntimeMessageInput);
	}

	emitDidReceiveRuntimeMessageError(languageRuntimeMessageError: ILanguageRuntimeMessageError) {
		this._onDidReceiveRuntimeMessageErrorEmitter.fire(languageRuntimeMessageError);
	}

	emitDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt: ILanguageRuntimeMessagePrompt) {
		this._onDidReceiveRuntimeMessagePromptEmitter.fire(languageRuntimeMessagePrompt);
	}

	emitDidReceiveRuntimeMessageState(languageRuntimeMessageState: ILanguageRuntimeMessageState) {
		this._onDidReceiveRuntimeMessageStateEmitter.fire(languageRuntimeMessageState);
	}

	emitDidReceiveRuntimeMessagePromptConfig() {
		this._onDidReceiveRuntimeMessagePromptConfigEmitter.fire();
	}

	emitState(clock: number, state: RuntimeState): void {
		// Add the state change to the event queue
		const event = new QueuedRuntimeStateEvent(clock, state);
		this.addToEventQueue(event);
	}

	emitExit(exit: ILanguageRuntimeExit): void {
		this._exitEmitter.fire(exit);
	}

	/**
	 * Relays a message from the server side of a comm to the client side.
	 */
	emitDidReceiveClientMessage(message: ILanguageRuntimeMessageCommData): void {
		const client = this._clients.get(message.comm_id);
		if (client) {
			client.emitData(message);
		} else {
			this._logService.warn(`Client instance '${message.comm_id}' not found; dropping message: ${JSON.stringify(message)}`);
		}
	}

	/**
	 * Opens a client instance (comm) on the front end. This is called when a new
	 * comm is created on the back end.
	 */
	openClientInstance(message: ILanguageRuntimeMessageCommOpen): void {
		// If the target name is not a valid client type, remove the client on
		// the back end instead of creating an instance wrapper on the front
		// end.
		if (!Object.values(RuntimeClientType).includes(message.target_name as RuntimeClientType)) {
			this._proxy.$removeClient(this.handle, message.comm_id);
			return;
		}

		// Create a new client instance wrapper on the front end. This will be
		// used to relay messages to the server side of the comm.
		const client = new ExtHostRuntimeClientInstance<any, any>(
			message.comm_id,
			message.target_name as RuntimeClientType,
			this.handle, this._proxy);

		// Save the client instance so we can relay messages to it
		this._clients.set(message.comm_id, client);

		// The client instance is now connected, since it already exists on the back end
		client.setClientState(RuntimeClientState.Connected);

		// Fire an event to notify listeners that a new client instance has been created
		this._onDidCreateClientInstanceEmitter.fire({ client, message });
	}

	/**
	 * Updates the state of a client from the server side of a comm.
	 */
	emitClientState(id: string, state: RuntimeClientState): void {
		const client = this._clients.get(id);
		if (client) {
			client.setClientState(state);
		} else {
			this._logService.warn(`Client instance '${id}' not found; dropping state change: ${state}`);
		}
	}

	/** Gets the current state of the notebook runtime */
	getRuntimeState(): RuntimeState {
		return this._currentState;
	}

	openResource(resource: URI | string): Thenable<boolean> {
		return this._proxy.$openResource(this.handle, resource);
	}

	execute(code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void {
		this._proxy.$executeCode(this.handle, code, id, mode, errorBehavior);
	}

	isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus> {
		return this._proxy.$isCodeFragmentComplete(this.handle, code);
	}

	/** Create a new client inside the runtime */
	createClient<Input, Output>(type: RuntimeClientType, params: any):
		Thenable<IRuntimeClientInstance<Input, Output>> {
		// Create an ID for the client.
		const id = this.generateClientId(this.metadata.languageId, type);

		// Create the new instance and add it to the map.
		const client = new ExtHostRuntimeClientInstance<Input, Output>(id, type, this.handle, this._proxy);
		this._clients.set(id, client);
		this._logService.info(`Creating ${type} client '${id}'...`);
		client.setClientState(RuntimeClientState.Opening);

		// Kick off the creation of the client on the server side. There's no
		// reply defined to this call in the protocol, so this is almost
		// fire-and-forget; we need to return the instance right away so that
		// the client can start listening to events.
		//
		// If the creation fails on the server, we'll either get an error here
		// or see the server end get closed immediately via a CommClose message.
		// In either case we'll let the client know.
		this._proxy.$createClient(this.handle, id, type, params).then(() => {
			// There is no protocol message indicating that the client has been
			// successfully created, so presume it's connected once the message
			// has been safely delivered, and handle the close event if it
			// happens.
			if (client.getClientState() === RuntimeClientState.Opening) {
				client.setClientState(RuntimeClientState.Connected);
			} else {
				this._logService.trace(`Client '${id}' in runtime '${this.metadata.runtimeName}' ` +
					`was closed instead of being created; it is unsupported by this runtime.`);
				client.setClientState(RuntimeClientState.Closed);
			}
		}).catch((err) => {
			this._logService.error(`Failed to create client '${id}' ` +
				`in runtime '${this.metadata.runtimeName}': ${err}`);
			client.setClientState(RuntimeClientState.Closed);
			this._clients.delete(id);
		});

		return Promise.resolve(client);
	}

	/** List active clients */
	listClients(type?: RuntimeClientType): Thenable<IRuntimeClientInstance<any, any>[]> {
		return new Promise((resolve, reject) => {
			this._proxy.$listClients(this.handle, type).then(clients => {
				// Array to hold resolved set of clients. This will be a combination of clients
				// already known to the extension host and new clients that need to be created.
				const instances = new Array<IRuntimeClientInstance<any, any>>();

				// Loop over each client ID and check if we already have an instance for it;
				// if not, create a new instance and add it to the list.
				Object.keys(clients).forEach((key) => {
					// Check for it in the list of active clients; if it's there, add it to the
					// list of instances and move on.
					const instance = this._clients.get(key);
					if (instance) {
						instances.push(instance);
						return;
					}
					// We don't know about this client yet. Create a new
					// instance and add it to the list, if it's a valid client
					// type.
					const clientType = clients[key];
					if (Object.values(RuntimeClientType).includes(clientType as RuntimeClientType)) {
						// We know what type of client this is, so create a new
						// instance and add it to the list.
						const client = new ExtHostRuntimeClientInstance<any, any>(
							key,
							clientType as RuntimeClientType,
							this.handle,
							this._proxy);

						// The client instance is now connected, since it
						// already exists on the back end
						client.setClientState(RuntimeClientState.Connected);
						this._clients.set(key, client);
						instances.push(client);
					} else {
						// We don't know what type of client this is, so
						// just log a warning and ignore it.
						this._logService.warn(`Ignoring unknown client type '${clientType}' for client '${key}'`);
					}
				});

				resolve(instances);
			}).catch((err) => {
				reject(err);
			});
		});
	}

	replyToPrompt(id: string, value: string): void {
		this._proxy.$replyToPrompt(this.handle, id, value);
	}

	async interrupt(): Promise<void> {
		this._stateEmitter.fire(RuntimeState.Interrupting);
		return this._proxy.$interruptLanguageRuntime(this.handle);
	}

	async restart(): Promise<void> {
		if (!this.canShutdown()) {
			throw new Error(`Cannot restart runtime '${this.metadata.runtimeName}': ` +
				`runtime is in state '${this._currentState}'`);
		}
		this._stateEmitter.fire(RuntimeState.Restarting);
		return this._proxy.$restartLanguageRuntime(this.handle);
	}

	async shutdown(exitReason = RuntimeExitReason.Shutdown): Promise<void> {
		if (!this.canShutdown()) {
			throw new Error(`Cannot shut down runtime '${this.metadata.runtimeName}': ` +
				`runtime is in state '${this._currentState}'`);
		}
		this._stateEmitter.fire(RuntimeState.Exiting);
		return this._proxy.$shutdownLanguageRuntime(this.handle, exitReason);
	}

	async forceQuit(): Promise<void> {
		// No check for state here; we can force quit the runtime at any time.
		return this._proxy.$forceQuitLanguageRuntime(this.handle);
	}

	async showOutput(): Promise<void> {
		return this._proxy.$showOutputLanguageRuntime(this.handle);
	}

	/**
	 * Checks to see whether the runtime can be shut down or restarted.
	 *
	 * @returns true if the runtime can be shut down or restarted, false otherwise
	 */
	private canShutdown(): boolean {
		return this._currentState === RuntimeState.Busy ||
			this._currentState === RuntimeState.Idle ||
			this._currentState === RuntimeState.Ready;
	}

	start(): Promise<ILanguageRuntimeInfo> {
		return new Promise((resolve, reject) => {
			this._proxy.$startLanguageRuntime(this.handle).then((info) => {
				// Update prompts in case user has customised them. Trim
				// trailing whitespace as the rendering code adds its own
				// whitespace.
				if (info.input_prompt) {
					this.dynState.inputPrompt = info.input_prompt.trimEnd();
				}
				if (info.continuation_prompt) {
					this.dynState.continuationPrompt = info.continuation_prompt.trimEnd();
				}

				this._startupEmitter.fire(info);
				resolve(info);
			}).catch((err) => {
				// Examine the error object to see what kind of failure it is
				if (err.message && err.details) {
					// We have an error message and details; use both
					this._startupFailureEmitter.fire(err satisfies ILanguageRuntimeStartupFailure);
					reject(err.message);
				} else if (err.message) {
					// We only have a message.
					this._startupFailureEmitter.fire({
						message: err.message,
						details: ''
					} satisfies ILanguageRuntimeStartupFailure);
					reject(err.message);
				} else {
					// Not an error object, or it doesn't have a message; just use the string
					this._startupFailureEmitter.fire({
						message: err.toString(),
						details: ''
					} satisfies ILanguageRuntimeStartupFailure);
					reject(err);
				}
			});
		});
	}

	/**
	 * Generates a client ID for a language runtime client instance.
	 *
	 * @param languageId The ID of the language that the client is associated with, such as "python"
	 * @param clientType The type of client for which to generate an ID
	 * @returns A unique ID for the client, such as "positron-environment-python-1-f2ef6a9a"
	 */
	private generateClientId(languageId: string, clientType: RuntimeClientType): string {
		// Generate a random 8-character hexadecimal string to serve as this client's ID
		const randomId = Math.floor(Math.random() * 0x100000000).toString(16);

		// Generate a unique auto-incrementing ID for this client
		const nextId = ExtHostLanguageRuntimeAdapter.clientCounter++;

		// Replace periods in the language ID with hyphens, so that the generated ID contains only
		// alphanumeric characters and hyphens
		const client = clientType.replace(/\./g, '-');

		// Return the generated client ID
		return `${client}-${languageId}-${nextId}-${randomId}`;
	}

	/**
	 * Adds an event to the queue, then processes the event queue, or schedules
	 * a deferred processing if the event clock is not yet ready.
	 *
	 * @param event The new event to add to the queue.
	 */
	private addToEventQueue(event: QueuedRuntimeEvent): void {
		const clock = event.clock;

		// If the event happened before our current clock value, it's out of
		// order.
		if (clock < this._eventClock) {
			if (event instanceof QueuedRuntimeMessageEvent) {
				// Emit messages out of order, with a warning.
				this._logService.warn(`Received '${event.summary()}' at tick ${clock} ` +
					`while waiting for tick ${this._eventClock + 1}; emitting anyway`);
				this.processMessage(event.message);
			}

			// We intentionally ignore state changes here; runtime state
			// changes supercede each other, so emitting one out of order
			// would leave the UI in an inconsistent state.
			return;
		}

		// Add the event to the queue.
		this._eventQueue.push(event);

		if (clock === this._eventClock + 1 || this._eventClock === 0) {
			// We have received the next message in the sequence (or we have
			// never received a message); process the queue immediately.
			this.processEventQueue();
		} else {
			// Log an INFO level message; this can happen if we receive messages
			// out of order, but it's normal for this to happen due to message
			// batching from the extension host.
			this._logService.info(`Received '${event.summary()}' at tick ${clock} ` +
				`while waiting for tick ${this._eventClock + 1}; deferring`);

			// The message that arrived isn't the next one in the sequence, so
			// wait for the next message to arrive before processing the queue.
			//
			// We don't want to wait forever, so debounce the queue processing
			// to occur after a short delay. If the next message in the sequence
			// doesn't arrive by then, we'll process the queue anyway.
			if (this._eventQueueTimer) {
				clearTimeout(this._eventQueueTimer);
				this._eventQueueTimer = undefined;
			}
			this._eventQueueTimer = setTimeout(() => {
				// Warn that we're processing the queue after a timeout; this usually
				// means we're going to process messages out of order because the
				// next message in the sequence didn't arrive in time.
				this._logService.warn(`Processing runtime event queue after timeout; ` +
					`event ordering issues possible.`);
				this.processEventQueue();
			}, 250);
		}
	}

	private processEventQueue(): void {
		// Clear the timer, if there is one.
		clearTimeout(this._eventQueueTimer);
		this._eventQueueTimer = undefined;

		// Typically, there's only ever 1 message in the queue; if there are 2
		// or more, it means that we've received messages out of order
		if (this._eventQueue.length > 1) {

			// Sort the queue by event clock, so that we can process messages in
			// order.
			this._eventQueue.sort((a, b) => {
				return a.clock - b.clock;
			});

			// Emit an INFO level message with the number of events in the queue
			// and the clock value of each event, for diagnostic purposes.
			this._logService.info(`Processing ${this._eventQueue.length} runtime events. ` +
				`Clocks: ` + this._eventQueue.map((e) => {
					return `${e.clock}: ${e.summary()}`;
				}).join(', '));
		}

		// Process each event in the sorted queue.
		this._eventQueue.forEach((event) => {
			// Update our view of the event clock.
			this._eventClock = event.clock;

			// Handle the event.
			this.handleQueuedEvent(event);
		});

		// Clear the queue.
		this._eventQueue = [];
	}

	private handleQueuedEvent(event: QueuedRuntimeEvent): void {
		if (event instanceof QueuedRuntimeMessageEvent) {
			this.processMessage(event.message);
		} else if (event instanceof QueuedRuntimeStateEvent) {
			this._stateEmitter.fire(event.state);
		}
	}

	/**
	 * Given a message from the language runtime, infer the kind of output that
	 * we should display for the message. The protocol allows a message to
	 * contain output in multiple formats, designated by MIME types; the goal of
	 * this routine is to centralize the logic around which MIME type to use for
	 * display.
	 *
	 * @param message A message from the language runtime
	 * @returns The kind of output that the message represents
	 */
	private inferPositronOutputKind(message: ILanguageRuntimeMessageOutput): RuntimeOutputKind {
		const mimeTypes = Object.keys(message.data);

		// The most common type of output is plain text, so short-circuit for that before we
		// do any more expensive processing.
		if (mimeTypes.length === 1 && mimeTypes[0] === 'text/plain') {
			return RuntimeOutputKind.Text;
		}

		// Short-circuit for static image types
		if (mimeTypes.length === 1 && mimeTypes[0].startsWith('image/')) {
			return RuntimeOutputKind.StaticImage;
		}

		// Check to see if the message itself indicates where it'd like to be placed.
		if (Object.keys(message).includes('output_location')) {
			const webOutput = message as ILanguageRuntimeMessageWebOutput;
			switch (webOutput.output_location) {
				case PositronOutputLocation.Console:
					return RuntimeOutputKind.InlineHtml;
				case PositronOutputLocation.Viewer:
					return RuntimeOutputKind.ViewerWidget;
				case PositronOutputLocation.Plot:
					return RuntimeOutputKind.PlotWidget;
			}
		}

		// Check to see if there are any renderers registered for the type.
		// These renderers are custom built for displaying notebook output in VS
		// Code / Positron so should have priority over other visualization
		// types.
		for (const mimeType of mimeTypes) {
			// These mime types are exclusive to IPyWidgets, and should be coded as such.
			if (mimeType === MIME_TYPE_WIDGET_STATE || mimeType === MIME_TYPE_WIDGET_VIEW) {
				return RuntimeOutputKind.IPyWidget;
			}

			if (mimeType.startsWith('application/') ||
				mimeType === 'text/markdown' ||
				mimeType.startsWith('text/x-')) {
				const renderer = this._notebookService.getPreferredRenderer(mimeType);
				if (renderer) {
					// Mime type guessing: if it has "table" in the name, it's
					// probably tabular data, which should go in the Viewer.
					// Same deal for text-based output types.
					if (mimeType.indexOf('table') >= 0 || mimeType.startsWith('text/')) {
						return RuntimeOutputKind.ViewerWidget;
					} else {
						return RuntimeOutputKind.PlotWidget;
					}
				}
			}
		}

		// If there's an HTML representation, use that.
		if (mimeTypes.includes('text/html')) {
			// Check to see if there are any <script>, <html>, or <body> tags.
			if (/<(script|html|body)/.test(message.data['text/html'])) {
				// This looks like standalone HTML.
				if (message.data['text/html'].includes('<table')) {
					// Tabular data? Probably best in the Viewer pane.
					return RuntimeOutputKind.ViewerWidget;
				} else {
					// Guess that anything else is a plot.
					return RuntimeOutputKind.PlotWidget;
				}
			} else {
				// This looks like a small HTML fragment we can render inline.
				return RuntimeOutputKind.InlineHtml;
			}
		}

		// We have now eliminated all rich output types; if _any_ output type is an image, use it.
		for (const mimeType of mimeTypes) {
			if (mimeType.startsWith('image/')) {
				return RuntimeOutputKind.StaticImage;
			}
		}

		// At this point, use the lowest common denominator (plain text) if it exists.
		if (mimeTypes.includes('text/plain')) {
			return RuntimeOutputKind.Text;
		}

		// If we get here, we don't know what kind of output this is.
		return RuntimeOutputKind.Unknown;
	}

	private emitRuntimeMessageOutput(message: ILanguageRuntimeMessageOutput): void {
		const outputMessage: ILanguageRuntimeMessageOutput = {
			// The incoming message from the backend doesn't actually have a
			// 'kind' property; we amend it with one here.
			//
			// @ts-ignore
			kind: this.inferPositronOutputKind(message),
			...message,
		};
		this.emitDidReceiveRuntimeMessageOutput(outputMessage);
	}

	private processMessage(message: ILanguageRuntimeMessage): void {
		// Broker the message type to one of the discrete message events.
		switch (message.type) {
			case LanguageRuntimeMessageType.Stream:
				this.emitDidReceiveRuntimeMessageStream(message as ILanguageRuntimeMessageStream);
				break;

			case LanguageRuntimeMessageType.Output:
				this.emitRuntimeMessageOutput(message as ILanguageRuntimeMessageOutput);
				break;

			case LanguageRuntimeMessageType.Input:
				this.emitDidReceiveRuntimeMessageInput(message as ILanguageRuntimeMessageInput);
				break;

			case LanguageRuntimeMessageType.Error:
				this.emitDidReceiveRuntimeMessageError(message as ILanguageRuntimeMessageError);
				break;

			case LanguageRuntimeMessageType.Prompt:
				this.emitDidReceiveRuntimeMessagePrompt(message as ILanguageRuntimeMessagePrompt);
				break;

			case LanguageRuntimeMessageType.State:
				this.emitDidReceiveRuntimeMessageState(message as ILanguageRuntimeMessageState);
				break;

			case LanguageRuntimeMessageType.CommOpen:
				this.openClientInstance(message as ILanguageRuntimeMessageCommOpen);
				break;

			case LanguageRuntimeMessageType.CommData:
				this.emitDidReceiveClientMessage(message as ILanguageRuntimeMessageCommData);
				break;

			case LanguageRuntimeMessageType.CommClosed:
				this.emitClientState((message as ILanguageRuntimeMessageCommClosed).comm_id, RuntimeClientState.Closed);
				break;
		}
	}

	static clientCounter = 0;
}

/**
 * Represents the front-end instance of a client widget inside a language runtime.
 *
 * Its lifetime is tied to the lifetime of the client widget and associated server
 * component. It is presumed that the comm channel has already been established
 * between the client and server; this class is responsible for managing the
 * communication channel and closing it when the client is disposed.
 */
class ExtHostRuntimeClientInstance<Input, Output>
	extends Disposable
	implements IRuntimeClientInstance<Input, Output> {

	private readonly _stateEmitter = new Emitter<RuntimeClientState>();

	private readonly _dataEmitter = new Emitter<Output>();

	private readonly _pendingRpcs = new Map<string, DeferredPromise<any>>();

	private _state: RuntimeClientState = RuntimeClientState.Uninitialized;

	constructor(
		private readonly _id: string,
		private readonly _type: RuntimeClientType,
		private readonly _handle: number,
		private readonly _proxy: ExtHostLanguageRuntimeShape) {
		super();

		this.onDidChangeClientState = this._stateEmitter.event;
		this._register(this._stateEmitter);

		this.onDidReceiveData = this._dataEmitter.event;
		this._register(this._dataEmitter);

		this._stateEmitter.event((state) => {
			this._state = state;
		});
	}

	/**
	 * Performs an RPC call to the server side of the comm.
	 *
	 * @param request The request to send to the server.
	 * @returns A promise that will be resolved with the response from the server.
	 */
	performRpc<T>(request: Input): Promise<T> {
		// Generate a unique ID for this message.
		const messageId = generateUuid();

		// Add the promise to the list of pending RPCs.
		const promise = new DeferredPromise<T>();
		this._pendingRpcs.set(messageId, promise);

		// Send the message to the server side.
		this._proxy.$sendClientMessage(this._handle, this._id, messageId, request);

		// Start a timeout to reject the promise if the server doesn't respond.
		//
		// TODO(jmcphers): This timeout value should be configurable.
		setTimeout(() => {
			// If the promise has already been resolved, do nothing.
			if (promise.isSettled) {
				return;
			}

			// Otherwise, reject the promise and remove it from the list of pending RPCs.
			promise.error(new Error(`RPC timed out after 5 seconds: ${JSON.stringify(request)}`));
			this._pendingRpcs.delete(messageId);
		}, 5000);

		// Return a promise that will be resolved when the server responds.
		return promise.p;
	}

	/**
	 * Sends a message (of any type) to the server side of the comm. This is only used for
	 * fire-and-forget messages; RPCs should use performRpc instead.
	 *
	 * @param message Message to send to the server
	 */
	sendMessage(message: any): void {
		// Generate a unique ID for this message.
		const messageId = generateUuid();

		// Send the message to the server side.
		this._proxy.$sendClientMessage(this._handle, this._id, messageId, message);
	}

	/**
	 * Emits a message (of any type) to the client side of the comm. Handles
	 * both events and RPC responses.
	 *
	 * @param message The message to emit to the client
	 */
	emitData(message: ILanguageRuntimeMessageCommData): void {
		if (message.parent_id && this._pendingRpcs.has(message.parent_id)) {
			// This is a response to an RPC call; resolve the deferred promise.
			const promise = this._pendingRpcs.get(message.parent_id);
			promise?.complete(message.data);
			this._pendingRpcs.delete(message.parent_id);
		} else {
			// This is a regular message; emit it to the client as an event.
			this._dataEmitter.fire(message.data as Output);
		}
	}

	/**
	 * Sets the state of the client by firing an event bearing the new state.
	 *
	 * @param state The new state of the client
	 */
	setClientState(state: RuntimeClientState): void {
		this._stateEmitter.fire(state);
	}

	onDidChangeClientState: Event<RuntimeClientState>;

	onDidReceiveData: Event<Output>;

	getClientState(): RuntimeClientState {
		return this._state;
	}

	getClientId(): string {
		return this._id;
	}

	getClientType(): RuntimeClientType {
		return this._type;
	}

	public override dispose(): void {
		super.dispose();

		// Cancel any pending RPCs
		for (const promise of this._pendingRpcs.values()) {
			promise.error('The language runtime exited before the RPC completed.');
		}

		// If we aren't currently closed, clean up before completing disposal.
		if (this._state !== RuntimeClientState.Closed) {
			// If we are actually connected to the backend, notify the backend that we are
			// closing the connection from our side.
			if (this._state === RuntimeClientState.Connected) {
				this._stateEmitter.fire(RuntimeClientState.Closing);
				this._proxy.$removeClient(this._handle, this._id);
			}

			// Emit the closed event.
			this._stateEmitter.fire(RuntimeClientState.Closed);
		}
	}
}

@extHostNamedCustomer(MainPositronContext.MainThreadLanguageRuntime)
export class MainThreadLanguageRuntime implements MainThreadLanguageRuntimeShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostLanguageRuntimeShape;

	private readonly _runtimes: Map<number, ExtHostLanguageRuntimeAdapter> = new Map();

	constructor(
		extHostContext: IExtHostContext,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
		@IPositronHelpService private readonly _positronHelpService: IPositronHelpService,
		@IPositronPlotsService private readonly _positronPlotService: IPositronPlotsService,
		@IPositronIPyWidgetsService private readonly _positronIPyWidgetsService: IPositronIPyWidgetsService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService
	) {
		// TODO@softwarenerd - We needed to find a central place where we could ensure that certain
		// Positron services were up and running early in the application lifecycle. For now, this
		// is where we're doing this.
		this._positronHelpService.initialize();
		this._positronConsoleService.initialize();
		this._positronVariablesService.initialize();
		this._positronPlotService.initialize();
		this._positronIPyWidgetsService.initialize();
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostLanguageRuntime);

		this._languageRuntimeService.onDidRequestLanguageRuntime((ILanguageRuntimeMetadata) => {
			this._proxy.$provideLanguageRuntime(ILanguageRuntimeMetadata.languageId,
				ILanguageRuntimeMetadata);
		});
		this._languageRuntimeService.onDidChangeDiscoveryPhase((phase) => {
			if (phase === LanguageRuntimeDiscoveryPhase.Discovering) {
				this._proxy.$discoverLanguageRuntimes();
			}
		});
	}

	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void {
		this.findRuntime(handle).handleRuntimeMessage(message);
	}

	$emitLanguageRuntimeState(handle: number, clock: number, state: RuntimeState): void {
		this.findRuntime(handle).emitState(clock, state);
	}

	$emitLanguageRuntimeExit(handle: number, exit: ILanguageRuntimeExit): void {
		this.findRuntime(handle).emitExit(exit);
	}

	// Called by the extension host to register a language runtime
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata, dynState: ILanguageRuntimeDynState): void {
		const adapter = new ExtHostLanguageRuntimeAdapter(
			handle,
			metadata,
			dynState,
			this._languageRuntimeService,
			this._logService,
			this._notebookService,
			this._proxy
		);
		this._runtimes.set(handle, adapter);

		this._languageRuntimeService.registerRuntime(adapter, metadata.startupBehavior);
	}

	$getPreferredRuntime(languageId: string): Promise<ILanguageRuntimeMetadata> {
		return Promise.resolve(this._languageRuntimeService.getPreferredRuntime(languageId).metadata);
	}

	$getRunningRuntimes(languageId: string): Promise<ILanguageRuntimeMetadata[]> {
		const runningRuntimes = () => this._languageRuntimeService.runningRuntimes.filter(runtime =>
			runtime.metadata.languageId === languageId
		);
		return Promise.resolve(runningRuntimes().map(runtime => runtime.metadata));
	}

	// Called by the extension host to select a previously registered language runtime
	$selectLanguageRuntime(handle: number): Promise<void> {
		return this._languageRuntimeService.selectRuntime(
			this.findRuntime(handle).metadata.runtimeId,
			'Extension-requested runtime selection via Positron API');
	}

	// Called by the extension host to restart a running language runtime
	$restartLanguageRuntime(handle: number): Promise<void> {
		return this._languageRuntimeService.restartRuntime(
			this.findRuntime(handle).metadata.runtimeId,
			'Extension-requested runtime restart via Positron API');
	}

	// Signals that language runtime discovery is complete.
	$completeLanguageRuntimeDiscovery(): void {
		this._languageRuntimeService.completeDiscovery();
	}

	$unregisterLanguageRuntime(handle: number): void {
		this._runtimes.delete(handle);
	}

	$executeCode(languageId: string, code: string, focus: boolean): Promise<boolean> {
		return this._positronConsoleService.executeCode(languageId, code, focus);
	}

	public dispose(): void {
		this._disposables.dispose();
	}

	private findRuntime(handle: number): ExtHostLanguageRuntimeAdapter {
		const runtime = this._runtimes.get(handle);
		if (!runtime) {
			throw new Error(`Unknown language runtime handle: ${handle}`);
		}

		return runtime;
	}
}
