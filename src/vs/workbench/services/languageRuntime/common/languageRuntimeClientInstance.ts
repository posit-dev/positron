/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';
import { ILanguageRuntimeMessageState } from './languageRuntimeService.js';

/**
 * The possible states for a language runtime client instance. These
 * represent the state of the communications channel between the client and
 * the runtime.
 */
export enum RuntimeClientState {
	/** The client has not yet been initialized */
	Uninitialized = 'uninitialized',

	/** The connection between the server and the client is being opened */
	Opening = 'opening',

	/** The connection between the server and the client has been established */
	Connected = 'connected',

	/** The connection between the server and the client is being closed */
	Closing = 'closing',

	/** The connection between the server and the client is closed */
	Closed = 'closed',
}

/**
 * Represents the status of a language runtime client. It's used to indicate
 * if it's currently executing RPC requests or not.
 */
export enum RuntimeClientStatus {
	Idle = 'idle',
	Busy = 'busy',
	Disconnected = 'closed',
}

/**
 * The set of client types that can be generated by a language runtime. Note
 * that, because client types can share a namespace with other kinds of
 * widgets, each client type in Positron's API is prefixed with the string
 * "positron".
 */
export enum RuntimeClientType {
	Variables = 'positron.variables',
	Lsp = 'positron.lsp',
	Plot = 'positron.plot',
	DataExplorer = 'positron.dataExplorer',
	Ui = 'positron.ui',
	Help = 'positron.help',
	Connection = 'positron.connection',
	Reticulate = 'positron.reticulate',
	IPyWidget = 'jupyter.widget',
	IPyWidgetControl = 'jupyter.widget.control',

	// Future client types may include:
	// - Watch window/variable explorer
	// - Code inspector
	// - etc.
}

export interface IRuntimeClientOutput<T> {
	data: T;
	buffers?: Array<VSBuffer>;
}

/**
 * An instance of a client widget generated by a language runtime. See
 * RuntimeClientType for the set of possible client types.
 *
 * This is a base interface that is extended by specific client types, and is
 * parameterized by two types:
 *
 * - `Input`: The type of data that the client sends to the runtime, i.e. the
 *    request type
 * - `Output`: The type of data that the client receives from the runtime, i.e.
 *    the response and event type
 *
 * The client is responsible for disposing itself when it is no longer
 * needed; this will trigger the closure of the communications channel
 * between the client and the runtime.
 *
 * It can also be disposed by the runtime, in which case the client will
 * be notified via the onDidChangeClientState event.
 */
export interface IRuntimeClientInstance<Input, Output> extends Disposable {
	onDidReceiveData: Event<IRuntimeClientOutput<Output>>;
	getClientId(): string;
	getClientType(): RuntimeClientType;
	performRpcWithBuffers(request: Input, timeout: number): Promise<IRuntimeClientOutput<Output>>;
	performRpc(request: Input, timeout: number | undefined, responseKeys: Array<string>): Promise<Output>;
	sendMessage(message: any, buffers?: VSBuffer[]): void;
	messageCounter: ISettableObservable<number>;
	clientState: ISettableObservable<RuntimeClientState>;
	clientStatus: ISettableObservable<RuntimeClientStatus>;
	updatePendingRpcState(message: ILanguageRuntimeMessageState): void;
}
