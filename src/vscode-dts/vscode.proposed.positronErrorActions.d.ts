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
		 * Declare the handler in `contributes.errorActionHandlers` in package.json,
		 * with its name and whether it can continue the user's active chat.
		 * Declared handlers are listed as options in the `ai.errorActions.agent` setting.
		 *
		 * Register during activation, as with commands and tools, whether or not
		 * the agent itself is installed: an error sent to a declared handler
		 * before it's registered activates its extension, and waits for that.
		 * The handler says what's missing when it's asked.
		 *
		 * Throws if the id isn't declared by this extension, is reserved, or is
		 * already registered in this extension host. An id already registered in
		 * another extension host is refused with a logged error and a disposable
		 * is returned that does nothing.
		 *
		 * @param id The id the handler is declared with.
		 * @param handler The handler.
		 * @returns A disposable that unregisters the handler.
		 */
		export function registerErrorActionHandler(id: string, handler: ErrorActionHandler): vscode.Disposable;

		/** Handles errors from the error actions such as Fix and Explain. */
		export interface ErrorActionHandler {
			/**
			 * Ask the handler to take the action on the error. Never called
			 * while `ai.enabled` is off.
			 *
			 * When the handler can't take the error because of a problem the
			 * user can fix (e.g. the agent or its command isn't installed, or a
			 * setting), tell the user why, with a way to fix it where there is
			 * one, and resolve. Reject only on unexpected
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
			 * Only true for handlers declared with `supportsChatContinuation`.
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
