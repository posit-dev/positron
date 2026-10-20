/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// In this file, "assistant" is a role: any AI assistant that can take errors.
// The product is always named in full, "Posit Assistant" or positAssistant*.

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** An action the user can take on an error. */
export type ErrorAssistantAction = 'fix' | 'explain';

/** What every error an action is taken on has, wherever it was raised. */
interface IErrorContextBase {
	/** The error output. The service strips ANSI escape codes before an assistant sees it. */
	readonly error: string;
}

/** An error raised by code run in a console session. */
interface IConsoleErrorContext extends IErrorContextBase {
	readonly kind: 'console';
}

/** An error raised by a notebook cell. */
interface INotebookErrorContext extends IErrorContextBase {
	readonly kind: 'notebook';
}

/** An error raised by a Quarto code cell. */
interface IQuartoErrorContext extends IErrorContextBase {
	readonly kind: 'quarto';
	/** The cell whose code raised the error. Undefined when it can't be found. */
	readonly cell?: IQuartoErroredCell;
}

/** A Quarto code cell, as it was when it raised an error. */
export interface IQuartoErroredCell {
	/** The Quarto document. */
	readonly uri: URI;
	/** Language ID of the cell, e.g. "python". */
	readonly languageId: string;
	/** The cell's label, e.g. from `#| label: fig-plot`. Undefined when it has none. */
	readonly label?: string;
	/** The cell's code. */
	readonly code: string;
	/** 1-based first line of the cell's code. */
	readonly startLine: number;
	/** 1-based last line of the cell's code, inclusive. */
	readonly endLine: number;
}

/** The error an action is taken on, tagged by where it was raised. */
export type IErrorAssistantContext = IConsoleErrorContext | INotebookErrorContext | IQuartoErrorContext;

/** How to send an error to an assistant. */
export interface IErrorAssistantOptions {
	/**
	 * Send the error to the user's active chat, or to a new chat if none is
	 * open, instead of always starting a new chat. The service ignores it
	 * unless the assistant {@link IErrorAssistantInfo.supportsChatContinuation supports it}.
	 */
	readonly continueChat?: boolean;
}

/** The read-only view of an assistant that callers see. */
export interface IErrorAssistantInfo {
	/** Unique identifier of the assistant. */
	readonly id: string;
	/** Name shown in the actions' tooltips and menus, e.g. "Posit Assistant". */
	readonly label: string;
	/** Whether the assistant can continue the user's active chat. */
	readonly supportsChatContinuation: boolean;
}

/**
 * An AI assistant's handling of the error Fix and Explain actions, e.g. Posit
 * Assistant's. Register it only while it can take errors.
 */
export interface IErrorAssistant extends IErrorAssistantInfo {
	/**
	 * Ask the assistant to take the action on the error. Reject on failure;
	 * the service reports it to the user.
	 */
	ask(action: ErrorAssistantAction, context: IErrorAssistantContext, options: IErrorAssistantOptions): Promise<void>;
}

export const IErrorAssistantService = createDecorator<IErrorAssistantService>('errorAssistantService');

/** Sends errors to the active assistant when the user presses Fix or Explain. */
export interface IErrorAssistantService {
	readonly _serviceBrand: undefined;

	/**
	 * The assistant errors are sent to: the first registered assistant, while
	 * `ai.enabled` is true. Undefined otherwise. An assistant that unregisters
	 * and registers again goes behind any others.
	 */
	readonly activeAssistant: IErrorAssistantInfo | undefined;

	/** Fires with the new active assistant when it changes. */
	readonly onDidChangeActiveAssistant: Event<IErrorAssistantInfo | undefined>;

	/**
	 * Register an assistant. Throws if one with the same id is already
	 * registered.
	 * @returns A disposable that unregisters the assistant.
	 */
	register(assistant: IErrorAssistant): IDisposable;

	/**
	 * Ask an assistant to take an action on an error. Does nothing while
	 * `ai.enabled` is off. Logs and notifies the user when no assistant has
	 * the id or the assistant fails; never rejects.
	 * @param assistantId The id of the assistant the user saw named.
	 */
	ask(assistantId: string, action: ErrorAssistantAction, context: IErrorAssistantContext, options: IErrorAssistantOptions): Promise<void>;
}
