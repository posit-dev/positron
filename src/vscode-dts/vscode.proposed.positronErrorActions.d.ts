/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/posit-dev/positron/issues/13603

// Positron's own proposal: it extends the `positron` module rather than
// `vscode`. Errors reach the handlers registered here only while the
// experimental `ai.errorActions.agents.enabled` setting is on.

declare module 'positron' {

	import * as vscode from 'vscode';

	export namespace ai {
		/**
		 * The error passed to {@link ErrorActionHandler} when the user presses Fix or
		 * Explain on an error.
		 */
		export interface ErrorActionContext {
			/** Plain-text error output, without ANSI escape codes. */
			readonly error: string;

			/** Where the error was raised. Undefined when it is not known. */
			readonly location?: ErrorLocation;

			/**
			 * Whether to start a new chat or continue the current one. Only
			 * 'current' while {@link ErrorActionHandlerRegistration.canContinueChat}
			 * is true.
			 */
			readonly chat: ErrorActionChat;
		}

		/**
		 * Whether to send an error to a new chat or the current one.
		 *
		 * - 'new': Start a new chat or session.
		 * - 'current': Continue the chat or session the user is working in, or
		 *   start a new one when there is none.
		 */
		export type ErrorActionChat = 'new' | 'current';

		/** Where an error passed to an {@link ErrorActionHandler} was raised. */
		export type ErrorLocation = ConsoleErrorLocation | NotebookErrorLocation | QuartoErrorLocation;

		/** An error raised by code run in a console session. */
		export interface ConsoleErrorLocation {
			readonly kind: 'console';

			/** The runtime session's ID. */
			readonly sessionId: string;

			/** The session's name shown in the console, e.g. "Python 3.12.1 (Venv: .venv)". */
			readonly sessionName: string;

			/** The session's language ID, e.g. "python". */
			readonly languageId: string;

			/**
			 * The code whose execution raised the error. Undefined when it is not
			 * known, e.g. when it was trimmed from the console's scrollback.
			 */
			readonly code?: string;
		}

		/** An error raised by a notebook cell. */
		export interface NotebookErrorLocation {
			readonly kind: 'notebook';

			/** The notebook's URI. */
			readonly uri: vscode.Uri;

			/** The 0-based index of the cell. Undefined when the cell no longer exists. */
			readonly cellIndex?: number;

			/**
			 * The cell's code, which may have unsaved changes. Undefined when the
			 * cell no longer exists.
			 */
			readonly code?: string;

			/** The cell's language ID, e.g. "python". Undefined when the cell no longer exists. */
			readonly languageId?: string;

			/** The ID of the notebook's runtime session. Undefined when it has none. */
			readonly sessionId?: string;
		}

		/** An error raised by a code chunk in a Quarto document. */
		export interface QuartoErrorLocation {
			readonly kind: 'quarto';

			/** The document's URI. */
			readonly uri: vscode.Uri;

			/** The chunk's language ID, e.g. "python". */
			readonly languageId: string;

			/** The 1-based first line of the chunk's code. */
			readonly startLine: number;

			/** The 1-based last line of the chunk's code, inclusive. */
			readonly endLine: number;

			/** The chunk's code, which may have unsaved changes. */
			readonly code: string;

			/** The chunk's label, e.g. from `#| label: fig-plot`. Undefined when it has none. */
			readonly label?: string;

			/** The ID of the document's runtime session. Undefined when it has none. */
			readonly sessionId?: string;
		}

		/**
		 * An implementation of the Fix and Explain actions on console,
		 * notebook, and Quarto errors, e.g. one that sends errors to a coding
		 * agent. The user picks which implementation handles errors with the
		 * "AI: Select Agent for Fix/Explain" command.
		 */
		export interface ErrorActionHandler {
			/**
			 * A context key expression, e.g. `myAgent.hasModel`, for when the
			 * handler is enabled. While it is false, errors go to Posit Assistant
			 * instead (or the actions are hidden when it is disabled too). Always
			 * enabled when undefined. Read once, at registration.
			 *
			 * Disable a handler only when it can't do anything useful. While it
			 * is enabled but can't send an error (e.g. a setting needs changing),
			 * set {@link ErrorActionHandlerRegistration.problem}, and tell the
			 * user why and how to fix it when they use it.
			 */
			readonly when?: string;

			/** Fix the error. */
			fix(context: ErrorActionContext, token: vscode.CancellationToken): Thenable<void>;

			/** Explain the error without changing any files. */
			explain(context: ErrorActionContext, token: vscode.CancellationToken): Thenable<void>;
		}

		/**
		 * Register an implementation of the error Fix and Explain actions.
		 *
		 * Register while the implementation is installed, and use
		 * {@link ErrorActionHandler.when} for whether it is enabled at the
		 * moment.
		 *
		 * @param id The unique identifier of the implementation. 'posit-assistant'
		 *   is reserved for Posit Assistant's, which Positron registers.
		 * @param label The human-readable name of the implementation, shown in the UI.
		 * @returns The registration, which unregisters the implementation when disposed.
		 */
		export function registerErrorActionHandler(id: string, label: string, handler: ErrorActionHandler): ErrorActionHandlerRegistration;

		/** A registered {@link ErrorActionHandler}. */
		export interface ErrorActionHandlerRegistration {
			/**
			 * Whether the handler can continue the current chat, which offers
			 * actions that pass `chat: 'current'`. Defaults to true. Update it
			 * when that changes, e.g. with the agent's settings.
			 */
			canContinueChat: boolean;

			/**
			 * What keeps the handler from working fully, e.g. "The claude
			 * command was not found on the PATH.", shown with it in the agent
			 * picker. Undefined, the default, while nothing does. Update it when
			 * that changes.
			 */
			problem: string | undefined;

			/** Unregister the handler. */
			dispose(): void;
		}
	}
}
