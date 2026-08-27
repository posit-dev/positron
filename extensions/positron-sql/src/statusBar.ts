/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { dialectName } from './dialects';
import { ConnectionRef } from './schema';
import { EffectiveSelection } from './selection';

/**
 * The status bar item that says which data connection the SQL file in front of the user is
 * written against, and the picker behind it.
 *
 * Modelled on the Python interpreter item: same side, same neighbourhood in the order, and the
 * same warning treatment when the thing the file needs is missing. A user who has met one should
 * not have to work out what the other is.
 */

/**
 * Immediately after the Python interpreter item, which sits at 100.09999.
 *
 * The two are never shown together -- one is for Python files and this is for SQL files -- so the
 * exact order between them does not matter, but the position in the bar does: this is where a
 * user of Positron already looks for "what is this file running against".
 */
const STATUS_BAR_ITEM_PRIORITY = 100.09998;

/** The id the item is registered under, which is what a user hides it by. */
const STATUS_BAR_ITEM_ID = 'sql.selectedDataConnection';

/**
 * The dialect a file is being read in, and where it came from.
 *
 * Where it came from is half the point of showing it: a dialect that looks wrong is either the
 * connection being something other than the user thought, or a setting they forgot they set, and
 * those are fixed in different places.
 */
export interface DialectInUse {
	/** The dialect name, or `''` for the permissive generic one. */
	readonly dialect: string;

	/** Whether `sql.dialect` set it, rather than the file's connection. */
	readonly fromSetting: boolean;
}

/** What the status bar item shows, and whether it shows it as a problem. */
export interface StatusBarState {
	readonly text: string;

	/**
	 * The hover, as markdown: the connection on one line, what that means for the file on the
	 * next, and the dialect last. Three short paragraphs rather than one sentence, because this is
	 * where a user comes to find out why a file is behaving as it is.
	 */
	readonly tooltip: vscode.MarkdownString;

	/**
	 * Whether to draw the item as a warning.
	 *
	 * True only when the file has no tables to complete against and something the user can do
	 * would give it some. Not for the ordinary "no choice made" case, which is the default and
	 * works.
	 */
	readonly warning: boolean;
}

/**
 * What the status bar says for a file, given what it is scoped to and what is open.
 *
 * Pure and exported: an empty completion list is nearly always explained by one of these four
 * states, so what each one says is the feature, and it is worth reading in a test.
 */
export function describeSelection(
	selection: EffectiveSelection,
	open: readonly ConnectionRef[],
	dialect: DialectInUse,
): StatusBarState {
	switch (selection.kind) {
		case 'connection':
			return {
				text: `$(database) ${selection.connection.name}`,
				tooltip: hover(
					selection.connection.name,
					vscode.l10n.t("Completions and name checks come from this data connection. Click to choose a different one."),
					dialect,
				),
				warning: false,
			};

		case 'closed':
			return {
				text: `$(alert) ${selection.connection.name}`,
				tooltip: hover(
					vscode.l10n.t("{0} is not open", selection.connection.name),
					vscode.l10n.t("Only SQL keywords are completed. Open it in the Connections pane, or click to choose a different data connection."),
					dialect,
				),
				warning: true,
			};

		case 'none':
			// Two ways to have nothing, and they are not the same job: open a connection, or say
			// which of the open ones this file is written against.
			return open.length === 0
				? {
					text: `$(alert) ${vscode.l10n.t("No Data Connection")}`,
					tooltip: hover(
						vscode.l10n.t("No data connection is open"),
						vscode.l10n.t("Only SQL keywords are completed. Open one in the Connections pane."),
						dialect,
					),
					warning: true,
				}
				: {
					text: `$(alert) ${vscode.l10n.t("Select Data Connection")}`,
					tooltip: hover(
						vscode.l10n.t("No data connection chosen"),
						vscode.l10n.t("{0} data connections are open. Click to say which one this file is written against; until then only SQL keywords are completed.", open.length),
						dialect,
					),
					warning: true,
				};
	}
}

/** The hover for a state: a heading, what it means, and the dialect the file is read in. */
function hover(heading: string, detail: string, dialect: DialectInUse): vscode.MarkdownString {
	const name = dialectName(dialect.dialect);
	const shown = name
		? (dialect.fromSetting
			// Named so the user knows to look there rather than at the connection, which is not
			// what is deciding it.
			? vscode.l10n.t("{0}, from the sql.dialect setting", name)
			: vscode.l10n.t("{0}, from the connection", name))
		// No dialect in play. Worth saying rather than leaving blank: it is why a statement some
		// database would reject is not being reported.
		: vscode.l10n.t("Generic, which accepts a superset of most dialects");

	return new vscode.MarkdownString([
		`**${heading}**`,
		detail,
		vscode.l10n.t("SQL dialect: {0}", shown),
	].join('\n\n'));
}

/** The status bar item itself, shown only while a SQL file is in front of the user. */
export class ConnectionStatusBar implements vscode.Disposable {

	private readonly _item: vscode.StatusBarItem;

	constructor(command: string) {
		this._item = vscode.window.createStatusBarItem(
			STATUS_BAR_ITEM_ID,
			vscode.StatusBarAlignment.Left,
			STATUS_BAR_ITEM_PRIORITY,
		);
		this._item.name = vscode.l10n.t("SQL Data Connection");
		this._item.command = command;
	}

	/**
	 * Shows a state, or hides the item entirely when given nothing.
	 *
	 * Hidden rather than blanked when the active editor is not SQL: the item answers a question
	 * only a SQL file raises, and a permanent one naming a database over a Python file would be
	 * noise the user cannot switch off without losing it where it matters.
	 */
	public update(state: StatusBarState | undefined): void {
		if (!state) {
			this._item.hide();
			return;
		}
		this._item.text = state.text;
		this._item.tooltip = state.tooltip;
		this._item.backgroundColor = state.warning
			? new vscode.ThemeColor('statusBarItem.warningBackground')
			: undefined;
		this._item.show();
	}

	public dispose(): void {
		this._item.dispose();
	}
}

/**
 * Asks which data connection a file is written against.
 *
 * Offers only connections that are open, and only one of them can be chosen: those are the ones
 * there is a schema to complete from, and a statement runs against one database. A closed
 * connection has nothing to offer until it is opened, and the Connections pane is where that is
 * done.
 *
 * @param open The connections the schema was last read from.
 * @param current What the file is scoped to now, shown as picked.
 * @returns The connection chosen, or undefined if the user dismissed the picker or there was
 *   nothing to pick.
 */
export async function pickConnection(
	open: readonly ConnectionRef[],
	current: ConnectionRef | undefined,
): Promise<ConnectionRef | undefined> {
	if (open.length === 0) {
		// Nothing to choose between. Offering an empty list would leave the user to work out that
		// the answer is somewhere else entirely.
		const connect = vscode.l10n.t("Open the Connections Pane");
		const answer = await vscode.window.showInformationMessage(
			vscode.l10n.t("No data connection is open, so there is nothing for this file to complete against."),
			connect,
		);
		if (answer === connect) {
			await vscode.commands.executeCommand('workbench.panel.positronDataConnections.focus');
		}
		return undefined;
	}

	const items: ConnectionItem[] = open.map(connection => ({
		label: connection.name,
		description: connection.profileId === current?.profileId
			? vscode.l10n.t("Current")
			: undefined,
		picked: connection.profileId === current?.profileId,
		connection,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t("Select Data Connection"),
		placeHolder: vscode.l10n.t("Which database is this file written against?"),
	});
	return picked?.connection;
}

interface ConnectionItem extends vscode.QuickPickItem {
	readonly connection: ConnectionRef;
}
