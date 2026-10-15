/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** An error action the user can take. */
export type ErrorActionKind = 'fix' | 'explain';

/** Whether to start a new chat or continue the current one. */
export type ErrorActionChat = 'new' | 'current';

/** An error raised by code run in a console session. */
export interface IConsoleErrorLocation {
	readonly kind: 'console';
}

/** An error raised by a notebook cell. */
export interface INotebookErrorLocation {
	readonly kind: 'notebook';
}

/** An error raised by a Quarto code chunk. */
export interface IQuartoErrorLocation {
	readonly kind: 'quarto';
	/** The chunk that raised the error. Undefined when it can't be found. */
	readonly chunk?: IQuartoErrorChunk;
}

/** A Quarto code chunk that raised an error. */
export interface IQuartoErrorChunk {
	/** Workspace-relative path of the Quarto document. */
	readonly path: string;
	/** Language ID of the chunk, e.g. "python". */
	readonly languageId: string;
	/** The chunk's label, e.g. from `#| label: fig-plot`. Undefined when it has none. */
	readonly label?: string;
	/** The chunk's code. */
	readonly code: string;
	/** 1-based first line of the chunk's code. */
	readonly startLine: number;
	/** 1-based last line of the chunk's code, inclusive. */
	readonly endLine: number;
}

/** Where an error was raised. */
export type IErrorLocation = IConsoleErrorLocation | INotebookErrorLocation | IQuartoErrorLocation;

/** The error passed to an error action handler when the user presses Fix or Explain. */
export interface IErrorActionContext {
	/** The error output. May contain ANSI escape codes. */
	readonly error: string;
	/** Where the error was raised. */
	readonly location: IErrorLocation;
	/** Whether to start a new chat or continue the current one. */
	readonly chat: ErrorActionChat;
}

/** An implementation of the error Fix and Explain actions. */
export interface IErrorActionHandler {
	/** Unique identifier of the handler. */
	readonly id: string;
	/** Name shown in the actions' tooltips, e.g. "Posit Assistant". */
	readonly label: string;
	/** When the handler can take errors; always when undefined. */
	readonly when?: ContextKeyExpression;
	/** Whether the handler can continue the current chat, which offers actions that do. */
	readonly canContinueChat: boolean;
	/** Run the given action on the error. Failures are surfaced to the user, not thrown. */
	run(kind: ErrorActionKind, context: IErrorActionContext): Promise<void>;
}

export const IErrorActionsService = createDecorator<IErrorActionsService>('errorActionsService');

/** Tracks the registered implementations of the error Fix and Explain actions. */
export interface IErrorActionsService {
	readonly _serviceBrand: undefined;

	/** Fires with the new active handler when it changes. */
	readonly onDidChangeActiveHandler: Event<IErrorActionHandler | undefined>;

	/**
	 * Register a handler. Logs and ignores a handler whose id is already
	 * registered.
	 * @returns A disposable that unregisters the handler.
	 */
	register(handler: IErrorActionHandler): IDisposable;

	/**
	 * The active handler, which errors are sent to: the first registered
	 * handler whose `when` is true. Undefined when there is none.
	 */
	readonly activeHandler: IErrorActionHandler | undefined;
}
