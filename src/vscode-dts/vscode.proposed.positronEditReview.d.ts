/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/posit-dev/positron/issues/15607

declare module 'positron' {

	import * as vscode from 'vscode';

	export namespace ai {
		/**
		 * Create a session whose tracked edits are shown in the editor for the
		 * user to keep or undo.
		 *
		 * @throws While `ai.enabled` is off.
		 */
		export function createEditReviewSession(): EditReviewSession;

		/**
		 * A set of file edits under review. Disposing the session leaves the
		 * files as they are; edits still pending stay reviewable until the user
		 * keeps or undoes them.
		 */
		export interface EditReviewSession extends vscode.Disposable {
			/**
			 * Run `callback`, which may create or modify `resources` on disk.
			 * The changes it makes become pending edits the user can keep or
			 * undo. Unsaved changes to `resources` are saved first.
			 *
			 * Notebooks (`*.ipynb`) and untitled documents are not tracked;
			 * changes to them are applied without review.
			 *
			 * @param resources The files `callback` may create or modify.
			 * @param callback Makes the edits.
			 * @returns The result of `callback`, once its edits are recorded.
			 */
			trackEdits<T>(resources: readonly vscode.Uri[], callback: () => Thenable<T>): Thenable<T>;

			/** The files edited in this session, and whether their edits are settled. */
			readonly entries: readonly EditReviewEntry[];

			/** Fires when a file is edited, or its edits are kept or undone. */
			readonly onDidChangeEntries: vscode.Event<readonly EditReviewEntry[]>;

			/** Keep the pending edits to `resources`, or to every file when omitted. */
			keep(resources?: readonly vscode.Uri[]): Thenable<void>;

			/** Undo the pending edits to `resources`, or to every file when omitted. */
			undo(resources?: readonly vscode.Uri[]): Thenable<void>;

			/** Open a diff of every file edited in this session. */
			show(): Thenable<void>;
		}

		/** A file edited in an {@link EditReviewSession}. */
		export interface EditReviewEntry {
			readonly uri: vscode.Uri;
			/** Whether the file's edits await review, or how the user last settled them. */
			readonly state: 'pending' | 'kept' | 'undone';
		}
	}
}
