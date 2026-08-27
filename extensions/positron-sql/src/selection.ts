/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConnectionRef } from './schema';

/**
 * Which data connection each SQL file is written against.
 *
 * One connection, never several. A statement runs against a single database, and the tables of
 * the others are not merely extra -- `orders` in the warehouse and `orders` in the local copy are
 * different tables with different columns, and a list holding both is wrong about whichever one
 * the file means.
 *
 * Per file rather than per window, because that is how SQL is actually kept: a report queries the
 * warehouse, a migration script the local database, and both are open at once. A window-wide
 * choice would have the user switching it every time they changed tab, and getting it wrong
 * silently in between.
 */

/**
 * What a file's schema is drawn from, once its choice is weighed against what is open.
 *
 * `closed` is kept apart from `none` deliberately. Both leave a file with no tables to complete,
 * but they call for different things: one connection has to be opened, and the other has to be
 * chosen.
 */
export type EffectiveSelection =
	| { readonly kind: 'none' }
	| { readonly kind: 'connection'; readonly connection: ConnectionRef }
	| { readonly kind: 'closed'; readonly connection: ConnectionRef };

/**
 * Weighs a file's choice against the connections that are open.
 *
 * Pure, and the whole of the rule: everything else here is bookkeeping around it.
 *
 * A file that has chosen nothing takes the only open connection, if there is exactly one. That is
 * not a guess -- there is nothing else it could mean -- and it keeps the common case, one database
 * and a window full of SQL, working without a click per file. With several open there is no
 * default worth having, so the file completes keywords only until the user says which one.
 *
 * @param chosen What the file was scoped to, if anything.
 * @param open The connections the schema was last read from.
 */
export function resolveSelection(
	chosen: ConnectionRef | undefined,
	open: readonly ConnectionRef[],
): EffectiveSelection {
	if (!chosen) {
		return open.length === 1 ? { kind: 'connection', connection: open[0] } : { kind: 'none' };
	}
	// Matched by id and reported under the name it is open as, so a connection the user has since
	// renamed is still the one they chose, and is named the way the Connections pane names it.
	const live = open.find(connection => connection.profileId === chosen.profileId);
	return live ? { kind: 'connection', connection: live } : { kind: 'closed', connection: chosen };
}

/**
 * What a file remembers: the connection it is written against, and how it was last run.
 *
 * The language hangs off the connection rather than standing beside it, because it is only ever
 * meaningful against one -- it is the language that connection's driver was connected with, and a
 * file pointed at a different database has to choose again. Storing it here also means changing
 * the connection forgets it, which is the right answer and takes no code to arrange.
 */
export interface RememberedConnection extends ConnectionRef {
	/**
	 * The language this file's statements were last run in, if they have been run.
	 *
	 * Only consulted when the session in front of the user does not settle it; see
	 * `chooseLanguage` in `execution.ts`.
	 */
	readonly languageId?: string;
}

/** Where the choices are kept between sessions; the workspace memento in production. */
export type SelectionStore = Pick<vscode.Memento, 'get' | 'update'>;

/** The memento key the choices are stored under. */
const STORAGE_KEY = 'connectionByDocument';

/**
 * How many files' choices to keep.
 *
 * The store is a plain map with no idea which files still exist, so without a cap a workspace
 * accumulates an entry for every SQL file ever opened in it. Least recently chosen goes first,
 * and losing one costs a user one pick from a list they were shown anyway.
 */
const MAX_REMEMBERED = 200;

/**
 * The connection each SQL file has been scoped to, kept across restarts.
 *
 * In the workspace's memento rather than in the file or in settings: which database a file is
 * written against is the user's own working state, not something to commit to a repository and
 * not something to impose on a colleague who has different connections configured.
 */
export class ConnectionSelection {

	private readonly _byFile: Map<string, RememberedConnection>;

	constructor(private readonly _store: SelectionStore) {
		this._byFile = new Map(storedSelections(_store));
	}

	public get(file: vscode.Uri): RememberedConnection | undefined {
		return this._byFile.get(file.toString());
	}

	/**
	 * Scopes a file to a connection, and remembers it for the next time the file is opened.
	 *
	 * Any language remembered for the file goes with the old connection. A different database is
	 * reached through a different driver, which may not offer the same languages at all.
	 */
	public set(file: vscode.Uri, connection: ConnectionRef): void {
		// Deleted before being set so that the entry moves to the end of the map. Insertion order
		// is what the cap trims by, and a file just chosen for is the last one to forget.
		this._byFile.delete(file.toString());
		this._byFile.set(file.toString(), {
			profileId: connection.profileId,
			name: connection.name,
			driverId: connection.driverId,
		});
		this._save();
	}

	/**
	 * Remembers the language a file's statements were run in, so the next run does not ask again.
	 *
	 * Kept only for a file that has chosen a connection: a language on its own says nothing, and
	 * the file will be asked which connection it means before it is asked anything else.
	 */
	public setLanguage(file: vscode.Uri, languageId: string): void {
		const chosen = this._byFile.get(file.toString());
		if (!chosen) {
			return;
		}
		this._byFile.set(file.toString(), { ...chosen, languageId });
		this._save();
	}

	/**
	 * Drops a closed file's choice, if that file's URI is one that gets handed out again.
	 *
	 * An untitled buffer's URI is reused for the next one, so a choice left behind would be
	 * inherited by a file the user never made it for. A file on disk keeps its choice: closing a
	 * file does not change which database it was written against, and remembering that across a
	 * restart is the point of storing it at all.
	 */
	public forgetIfTransient(file: vscode.Uri): void {
		if (!isPersistable(file)) {
			this._byFile.delete(file.toString());
		}
	}

	private _save(): void {
		const persisted: Record<string, RememberedConnection> = {};
		for (const [id, connection] of [...this._byFile].slice(-MAX_REMEMBERED)) {
			if (isPersistable(vscode.Uri.parse(id))) {
				persisted[id] = connection;
			}
		}
		// Not awaited: the memento write is a background flush, and nothing here reads it back
		// before the next window. A failure to write costs the user a re-pick, not correctness.
		void this._store.update(STORAGE_KEY, persisted);
	}
}

/**
 * Whether a URI still means the same document in the next session.
 *
 * Untitled URIs are handed out again from the start of each window, so a choice stored against one
 * would be inherited by whatever unrelated buffer got the name next. Everything else is kept,
 * including remote and virtual file systems, where a path is as stable as a local one.
 */
function isPersistable(uri: vscode.Uri): boolean {
	return uri.scheme !== 'untitled';
}

/** What was stored, with anything that is not a connection reference dropped. */
function storedSelections(store: SelectionStore): [string, RememberedConnection][] {
	const stored = store.get<Record<string, unknown>>(STORAGE_KEY, {});
	// Validated rather than trusted: this is data an older version of this extension wrote, and a
	// half-shaped entry would reach the status bar as a connection with no name. The language is
	// not required, because entries written before it existed do not carry one.
	return Object.entries(stored)
		.filter((entry): entry is [string, RememberedConnection] => isRememberedConnection(entry[1]));
}

function isRememberedConnection(value: unknown): value is RememberedConnection {
	const candidate = value as Partial<RememberedConnection> | null;
	return typeof candidate === 'object'
		&& candidate !== null
		&& typeof candidate.profileId === 'string'
		&& typeof candidate.name === 'string'
		&& typeof candidate.driverId === 'string'
		&& (candidate.languageId === undefined || typeof candidate.languageId === 'string');
}

