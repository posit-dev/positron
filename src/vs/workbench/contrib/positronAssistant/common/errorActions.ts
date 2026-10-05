/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { UriComponents } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** Setting that picks which implementation of the error Fix/Explain actions to use. */
export const ERROR_ACTIONS_TARGET_KEY = 'ai.errorActions.target';

/**
 * Built-in implementation: Posit Assistant, via its posit-assistant.newChat
 * command. Reserved; extensions cannot register it.
 */
export const POSIT_ASSISTANT_ERROR_ACTIONS_ID = 'posit-assistant';

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/** An error raised by code run in a console session. Mirrors `positron.ai.ConsoleErrorLocation`. */
export interface IConsoleErrorLocation {
	readonly kind: 'console';
	/** Runtime session ID. */
	readonly sessionId: string;
	/** Session name shown in the console, e.g. "Python 3.12.1 (Venv: .venv)". */
	readonly sessionName: string;
	/** Language ID, e.g. "python". */
	readonly languageId: string;
	/** Code whose execution raised the error; undefined when it is not known. */
	readonly code?: string;
}

/** An error raised by a notebook cell. Mirrors `positron.ai.NotebookErrorLocation`. */
export interface INotebookErrorLocation {
	readonly kind: 'notebook';
	readonly uri: UriComponents;
	/** 0-based index of the cell; undefined when the cell no longer exists. */
	readonly cellIndex?: number;
	/** ID of the notebook's runtime session; undefined when it has none. */
	readonly sessionId?: string;
}

/** An error raised by a Quarto code chunk. Mirrors `positron.ai.QuartoErrorLocation`. */
export interface IQuartoErrorLocation {
	readonly kind: 'quarto';
	readonly uri: UriComponents;
	/** Language ID of the chunk, e.g. "python". */
	readonly languageId: string;
	/** 1-based first line of the chunk's code. */
	readonly startLine: number;
	/** 1-based last line of the chunk's code, inclusive. */
	readonly endLine: number;
	/** ID of the document's runtime session; undefined when it has none. */
	readonly sessionId?: string;
}

/** Where an error was raised. Mirrors `positron.ai.ErrorLocation`. */
export type IErrorLocation = IConsoleErrorLocation | INotebookErrorLocation | IQuartoErrorLocation;

/**
 * The error passed to the registered error action handler when the user presses Fix or
 * Explain. Mirrors `positron.ai.ErrorActionContext`.
 */
export interface IErrorActionContext {
	/** Plain-text error output, ANSI-free. */
	readonly error: string;
	/** Where the error was raised. Undefined when it is not known. */
	readonly location?: IErrorLocation;
}

/** Fix and Explain implemented by an extension, e.g. one that sends errors to a coding agent. */
export interface IErrorActionHandler {
	/** Value of the implementation in the ai.errorActions.target setting. */
	readonly id: string;
	/** Name shown in the setting's dropdown. */
	readonly label: string;
	/** Run the given action on the error. */
	run(kind: ErrorActionKind, context: IErrorActionContext, token: CancellationToken): Promise<void>;
}

export const IErrorActionsService = createDecorator<IErrorActionsService>('errorActionsService');

/** Tracks registered implementations of the error Fix/Explain actions. */
export interface IErrorActionsService {
	readonly _serviceBrand: undefined;

	/** Fires when the registered implementations or the configured one change. */
	readonly onDidChange: Event<void>;

	/**
	 * Register an implementation. Logs and ignores a registration whose id is
	 * reserved or already registered.
	 */
	register(handler: IErrorActionHandler): IDisposable;

	/**
	 * The implementation selected in the ai.errorActions.target setting.
	 * Undefined when Posit Assistant is selected, or when the selected
	 * implementation is not registered (so callers fall back to Posit Assistant).
	 */
	getConfigured(): IErrorActionHandler | undefined;

	/**
	 * Run an action with a registered implementation. Failures are logged and
	 * surfaced as a notification rather than thrown.
	 */
	run(handler: IErrorActionHandler, kind: ErrorActionKind, context: IErrorActionContext): Promise<void>;
}
