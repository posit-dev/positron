/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/posit-dev/positron/issues/13603

// Positron's own proposal: it extends the `positron` module rather than
// `vscode`. Promote it to positron.d.ts once a second coding agent needs it.

declare module 'positron' {

	import * as vscode from 'vscode';

	export namespace ai {
		/**
		 * Register a handler that the Fix and Explain actions on console,
		 * notebook, and Quarto errors can send errors to. While it's registered,
		 * the `ai.errorActions.agent` setting lists it, and errors go to it once the
		 * user chooses it there. Register it while it exists, e.g. while its tool
		 * is installed, not only while it can take errors.
		 *
		 * Throws if the id is reserved by Positron or is already registered in
		 * this extension host. An id already registered in another extension
		 * host is refused with a logged error.
		 *
		 * @param id A unique identifier, stored as the setting's value.
		 * @param label The name shown in the setting and the actions' tooltips.
		 * @param handler The handler.
		 * @param metadata Optional {@link ErrorActionHandlerMetadata metadata} about the handler.
		 * @returns A disposable that unregisters the handler.
		 */
		export function registerErrorActionHandler(id: string, label: string, handler: ErrorActionHandler, metadata?: ErrorActionHandlerMetadata): vscode.Disposable;

		/**
		 * Metadata about an {@link ErrorActionHandler}, given when it's registered.
		 * To change it, dispose the registration and register again.
		 */
		export interface ErrorActionHandlerMetadata {
			/**
			 * Whether the handler can continue the user's active chat, which
			 * adds an "in current chat" choice to Fix and Explain. Defaults to false.
			 */
			readonly supportsChatContinuation?: boolean;
		}

		/** A coding agent's handling of errors from the Fix and Explain actions. */
		export interface ErrorActionHandler {
			/**
			 * Ask the handler to take the action on the error. Never called
			 * while `ai.enabled` is off.
			 *
			 * When the handler can't take the error because of a problem the
			 * user can fix (e.g. a missing command or a setting), tell the user
			 * why, with a way to fix it, and resolve. Reject only on unexpected
			 * failures; Positron reports them to the user.
			 */
			ask(action: ErrorAction, context: ErrorActionContext, options: ErrorActionOptions): Thenable<void>;
		}

		/** An action the user can take on an error. */
		export type ErrorAction = 'fix' | 'explain';

		/** How to send an error to a handler. */
		export interface ErrorActionOptions {
			/**
			 * Send the error to the user's active chat instead of a new one.
			 * Only true for handlers that {@link ErrorActionHandlerMetadata.supportsChatContinuation support it}.
			 */
			readonly continueChat: boolean;
		}

		/** The error an action is taken on, tagged by where it was raised. */
		export type ErrorActionContext = ConsoleErrorActionContext | NotebookErrorActionContext | QuartoErrorActionContext;

		/** An error raised by code run in a console session. */
		export interface ConsoleErrorActionContext {
			readonly kind: 'console';
			/** The error output, without ANSI escape codes. */
			readonly error: string;
			/** ID of the console's runtime session. */
			readonly sessionId: string;
			/** Name of the console's session, e.g. "Python 3.12.1 (Venv: .venv)". */
			readonly sessionName: string;
			/** Language ID of the session, e.g. "python". */
			readonly languageId: string;
			/**
			 * The code in the console's input for the error, as it is when the
			 * action is taken. Undefined when the console no longer has it.
			 */
			readonly code?: string;
		}

		/** An error raised by a notebook cell. */
		export interface NotebookErrorActionContext {
			readonly kind: 'notebook';
			/** The error output, without ANSI escape codes. */
			readonly error: string;
			/** ID of the notebook's runtime session. Undefined when none is known. */
			readonly sessionId?: string;
			/** The notebook. */
			readonly uri: vscode.Uri;
			/** The cell that raised the error. Undefined when it's no longer in the notebook. */
			readonly cell?: NotebookErroredCell;
		}

		/** A notebook cell that raised an error, as it is when the action is taken. */
		export interface NotebookErroredCell {
			/** 0-based index of the cell among all of the notebook's cells, markdown included. */
			readonly index: number;
			/** The cell's code, including unsaved edits. */
			readonly code: string;
			/** Language ID of the cell, e.g. "python". */
			readonly languageId: string;
		}

		/** An error raised by a Quarto code cell. */
		export interface QuartoErrorActionContext {
			readonly kind: 'quarto';
			/** The error output, without ANSI escape codes. */
			readonly error: string;
			/** ID of the document's runtime session. Undefined when none is known. */
			readonly sessionId?: string;
			/** The Quarto document. */
			readonly uri: vscode.Uri;
			/** The cell whose code raised the error. Undefined when it can't be found. */
			readonly cell?: QuartoErroredCell;
		}

		/** A Quarto code cell, as it was when it raised an error. */
		export interface QuartoErroredCell {
			/** Language ID of the cell, e.g. "python". */
			readonly languageId: string;
			/** The cell's label, e.g. from `#| label: fig-plot`. Undefined when it has none. */
			readonly label?: string;
			/** The cell's code, as it was run. */
			readonly code: string;
			/** 1-based first line of the cell's code. */
			readonly startLine: number;
			/** 1-based last line of the cell's code, inclusive. */
			readonly endLine: number;
		}
	}
}
