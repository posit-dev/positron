/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/posit-dev/positron/issues/13603

declare module 'positron' {

	import * as vscode from 'vscode';

	export namespace ai {
		/**
		 * Register a handler that the user can send errors to e.g. Fix and Explain.
		 *
		 * Registered handlers are listed as options in the `ai.errorActions.agent` setting.
		 *
		 * Register during activation, as with commands and tools: an error sent
		 * to a handler declared in `contributes.errorActionHandlers` before it's
		 * registered activates its extension, and waits for that.
		 *
		 * Throws if the id is reserved or is already registered in this extension host.
		 * An id already registered in another extension host is refused with a logged error
		 * and a disposable is returned that does nothing.
		 *
		 * @param id A unique identifier.
		 * @param label The handler's human-readable name, shown in the UI.
		 * @param handler The handler.
		 * @param metadata Optional metadata about the handler.
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

		/** Handles errors from the error actions such as Fix and Explain. */
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
			/** Name of the console's session. */
			readonly sessionName: string;
			/** Language ID of the session. */
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
			/** 0-based index of the cell among all of the notebook's cells. */
			readonly index: number;
			/** The cell's code, including unsaved edits. */
			readonly code: string;
			/** Language ID of the cell. */
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
			/** Language ID of the cell. */
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
