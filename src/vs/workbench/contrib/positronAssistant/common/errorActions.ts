/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { UriComponents } from '../../../../base/common/uri.js';
import { ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** Setting that picks the agent the error Fix/Explain actions send errors to. */
export const ERROR_ACTIONS_AGENT_KEY = 'ai.errorActions.agent';

/**
 * Posit Assistant's implementation, registered by Positron and the setting's
 * default. Reserved; extensions cannot register it.
 */
export const POSIT_ASSISTANT_ERROR_ACTIONS_ID = 'posit-assistant';

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/** Whether to start a new chat or continue the current one. Mirrors `positron.ai.ErrorActionChat`. */
export type ErrorActionChat = 'new' | 'current';

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
	/** The cell's code, which may have unsaved changes; undefined when the cell no longer exists. */
	readonly code?: string;
	/** Language ID of the cell, e.g. "python"; undefined when the cell no longer exists. */
	readonly languageId?: string;
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
	/** The chunk's code, which may have unsaved changes. */
	readonly code: string;
	/** The chunk's label, e.g. from `#| label: fig-plot`; undefined when it has none. */
	readonly label?: string;
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
	/** Whether to start a new chat or continue the current one. */
	readonly chat: ErrorActionChat;
}

/** An implementation of Fix and Explain, e.g. Posit Assistant or one that sends errors to a coding agent. */
export interface IErrorActionHandler {
	/** Value of the implementation in the ai.errorActions.agent setting. */
	readonly id: string;
	/** Name shown in the setting's dropdown and the actions' tooltips. */
	readonly label: string;
	/** When it is enabled; always when undefined. */
	readonly when?: ContextKeyExpression;
	/** Run the given action on the error. */
	run(kind: ErrorActionKind, context: IErrorActionContext, token: CancellationToken): Promise<void>;
}

/** A registered {@link IErrorActionHandler}. */
export interface IErrorActionHandlerRegistration extends IDisposable {
	/** Set whether the handler can continue the current chat. It can until this is called. */
	setCanContinueChat(canContinueChat: boolean): void;
}

export const IErrorActionsService = createDecorator<IErrorActionsService>('errorActionsService');

/** Tracks registered implementations of the error Fix/Explain actions. */
export interface IErrorActionsService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires when the registered implementations, the configured one, or
	 * whether a registered one can take errors or continue a chat change.
	 */
	readonly onDidChange: Event<void>;

	/**
	 * Register an implementation. Logs and ignores a registration whose id is
	 * already registered.
	 */
	register(handler: IErrorActionHandler): IErrorActionHandlerRegistration;

	/**
	 * The implementation selected in the ai.errorActions.agent setting, or
	 * Posit Assistant's when the selected one is not registered or its `when`
	 * is false.
	 * @returns The implementation, or undefined when neither can take errors,
	 *   in which case there is nowhere to send them.
	 */
	getConfigured(): IErrorActionHandler | undefined;

	/** Whether a registered implementation can continue the current chat, which offers actions that do. */
	canContinueChat(handler: IErrorActionHandler): boolean;

	/**
	 * Run an action with a registered implementation. Failures are logged and
	 * surfaced as a notification rather than thrown.
	 */
	run(handler: IErrorActionHandler, kind: ErrorActionKind, context: IErrorActionContext): Promise<void>;
}
