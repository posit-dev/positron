/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** An action the user can take on an error. */
export type ErrorAction = 'fix' | 'explain';

/** What every error an action is taken on has, wherever it was raised. */
interface IErrorContextBase {
	/** The error output. The service strips ANSI escape codes before a handler sees it. */
	readonly error: string;
	/** ID of the runtime session the code ran in. Undefined when none is known. */
	readonly sessionId?: string;
}

/** An error raised by code run in a console session. */
interface IConsoleErrorContext extends IErrorContextBase {
	readonly kind: 'console';
	/** ID of the console's runtime session, which a console always has. */
	readonly sessionId: string;
	/** Name of the console's session, e.g. "Python 3.12.1 (Venv: .venv)". */
	readonly sessionName: string;
	/** Language ID of the session, e.g. "python". */
	readonly languageId: string;
	/** The code that raised the error. Undefined when the console no longer has it. */
	readonly code?: string;
}

/** An error raised by a notebook cell. */
interface INotebookErrorContext extends IErrorContextBase {
	readonly kind: 'notebook';
	/** The notebook. */
	readonly uri: URI;
	/** The cell that raised the error. Undefined when it's no longer in the notebook. */
	readonly cell?: INotebookErroredCell;
}

/** An error raised by a Quarto code cell. */
interface IQuartoErrorContext extends IErrorContextBase {
	readonly kind: 'quarto';
	/** The Quarto document. */
	readonly uri: URI;
	/** The cell whose code raised the error. Undefined when it can't be found. */
	readonly cell?: IQuartoErroredCell;
}

/** A notebook cell that raised an error, as it is when the action is taken. */
interface INotebookErroredCell {
	/** 0-based index of the cell. */
	readonly index: number;
	/** The cell's code, including unsaved edits. */
	readonly code: string;
	/** Language ID of the cell, e.g. "python". */
	readonly languageId: string;
}

/** A Quarto code cell, as it was when it raised an error. */
export interface IQuartoErroredCell {
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
export type IErrorActionContext = IConsoleErrorContext | INotebookErrorContext | IQuartoErrorContext;

/** How to send an error to a handler. */
export interface IErrorActionOptions {
	/**
	 * Send the error to the user's active chat, or to a new chat if none is
	 * open, instead of always starting a new chat. The service ignores it
	 * unless the handler {@link IErrorActionHandlerInfo.supportsChatContinuation supports it}.
	 */
	readonly continueChat?: boolean;
}

/** The read-only view of a handler that callers see. */
export interface IErrorActionHandlerInfo {
	/** Unique identifier of the handler. */
	readonly id: string;
	/** Name shown in the actions' tooltips and menus, e.g. "Posit Assistant". */
	readonly label: string;
	/** Whether the handler can continue the user's active chat. */
	readonly supportsChatContinuation: boolean;
}

/**
 * An error action handler an extension declares in its package.json, under
 * `contributes.errorActionHandlers`. An extension can only register the
 * handlers it declares.
 */
export interface IErrorActionHandlerContribution {
	/** The id the extension registers the handler with. */
	readonly id: string;
	/** The handler's name, shown in the setting and the actions. */
	readonly label: string;
	/** Whether the handler can continue the user's active chat. Defaults to false. */
	readonly supportsChatContinuation?: boolean;
}

/** The well-formed handlers an extension contributes. */
export function getErrorActionHandlerContributions(extension: IExtensionDescription): IErrorActionHandlerContribution[] {
	const contributions = (extension.contributes as { errorActionHandlers?: unknown } | undefined)?.errorActionHandlers;
	if (!Array.isArray(contributions)) {
		return [];
	}
	return contributions.filter((contribution): contribution is IErrorActionHandlerContribution =>
		typeof contribution?.id === 'string'
		&& typeof contribution?.label === 'string'
		&& (contribution.supportsChatContinuation === undefined || typeof contribution.supportsChatContinuation === 'boolean'));
}

/**
 * A coding agent's handling of the error Fix and Explain actions. Register it
 * while the agent is installed, not only while it can take errors, so the
 * `ai.errorActions.agent` setting lists it and its buttons name it. Only the
 * default handler registers only while it can take errors.
 */
export interface IErrorActionHandler extends IErrorActionHandlerInfo {
	/**
	 * Ask the handler to take the action on the error. When it can't because
	 * of a problem the user can fix (e.g. a missing CLI or a setting), tell the
	 * user why, with a way to fix it, and resolve. Reject only on unexpected
	 * failures; the service reports them to the user.
	 */
	ask(action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions): Promise<void>;
}

export const IErrorActionHandlerService = createDecorator<IErrorActionHandlerService>('errorActionHandlerService');

/** Sends errors to the chosen handler when the user presses Fix or Explain. */
export interface IErrorActionHandlerService {
	readonly _serviceBrand: undefined;

	/**
	 * The handler errors are sent to: the one the `ai.errorActions.agent`
	 * setting chooses, never another. Show the Fix and Explain actions while
	 * it's defined. Undefined while `ai.enabled` is off, or while the default is
	 * chosen and not registered. Any other choice is active even while it isn't
	 * registered, named by its id, since choosing it is the opt-in.
	 */
	readonly activeHandler: IErrorActionHandlerInfo | undefined;

	/** Fires with the new active handler when it changes. */
	readonly onDidChangeActiveHandler: Event<IErrorActionHandlerInfo | undefined>;

	/**
	 * Register a handler, which lists it in the `ai.errorActions.agent`
	 * setting. Throws if one with the same id is already registered.
	 * @returns A disposable that unregisters the handler.
	 */
	register(handler: IErrorActionHandler): IDisposable;

	/**
	 * Ask a handler to take an action on an error. Does nothing while
	 * `ai.enabled` is off. Tells the user when the handler isn't available
	 * or fails; never rejects.
	 * @param handlerId The id of the handler the user saw named.
	 */
	ask(handlerId: string, action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions): Promise<void>;
}
