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
	/** The Quarto document. */
	readonly uri: URI;
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

/** The error an action is taken on. */
export interface IErrorAssistantContext {
	/** The error output, as plain text with no ANSI escape codes. */
	readonly error: string;
	/** Where the error was raised. */
	readonly location: IErrorLocation;
}

/** How to send an error to an assistant. */
export interface IErrorAssistantOptions {
	/**
	 * Send the error to the user's active chat, or to a new chat if none is
	 * open, instead of always starting a new chat. Only when the assistant
	 * {@link IErrorAssistantInfo.supportsChatContinuation supports it}.
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
	 * `ai.enabled` is true. Undefined otherwise.
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
	 * `ai.enabled` is off or when no assistant has the id. Logs and notifies
	 * the user on failure; never rejects.
	 * @param assistantId The id of the assistant the user saw named.
	 */
	ask(assistantId: string, action: ErrorAssistantAction, context: IErrorAssistantContext, options: IErrorAssistantOptions): Promise<void>;
}
