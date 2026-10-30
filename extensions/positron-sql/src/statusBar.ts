/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { dialectName } from './dialects';
import { escapeMarkdown } from './markdown';
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
 *
 * @param configured Every connection the user has set up, or undefined while the first schema
 *   read is still in flight. Until it lands nothing is known to be open, so every other state
 *   would be a false alarm: a chosen connection would read as closed, and a window with
 *   connections set up would read as having none.
 * @param dataConnectionsOff Whether Data Connections is switched off, which hides the item.
 *   There is no connection to name or choose then, and the setting may well be one an
 *   administrator enforces, so an item saying so would be a permanent pointer at something the
 *   user cannot change.
 * @returns What to show, or undefined to hide the item.
 */
export function describeSelection(
	selection: EffectiveSelection,
	configured: readonly ConnectionRef[] | undefined,
	dialect: DialectInUse,
	dataConnectionsOff = false,
): StatusBarState | undefined {
	if (dataConnectionsOff) {
		return undefined;
	}
	if (configured === undefined) {
		return {
			text: selection.kind === 'none'
				? `$(loading~spin) ${vscode.l10n.t("Data Connection")}`
				: `$(loading~spin) ${escapeIcons(selection.connection.name)}`,
			tooltip: hover(
				vscode.l10n.t("Reading data connections"),
				vscode.l10n.t("Completions and name checks start once the schema is read."),
				dialect,
			),
			warning: false,
		};
	}
	switch (selection.kind) {
		case 'connection':
			return {
				text: `$(database) ${escapeIcons(selection.connection.name)}`,
				tooltip: hover(
					selection.connection.name,
					vscode.l10n.t("Completions and name checks come from this data connection. Click to choose a different one."),
					dialect,
				),
				warning: false,
			};

		case 'closed':
			return {
				text: `$(alert) ${escapeIcons(selection.connection.name)}`,
				tooltip: hover(
					vscode.l10n.t("{0} is not open", selection.connection.name),
					vscode.l10n.t("Only SQL keywords are completed. Click to open it, or to choose a different data connection."),
					dialect,
				),
				warning: true,
			};

		case 'none':
			// Two ways to have nothing, and they are not the same job: set up a connection, or say
			// which of the ones set up this file is written against.
			return configured.length === 0
				? {
					text: `$(alert) ${vscode.l10n.t("No Data Connection")}`,
					tooltip: hover(
						vscode.l10n.t("No data connection is set up"),
						vscode.l10n.t("Only SQL keywords are completed. Add one in the Data Connections pane."),
						dialect,
					),
					warning: true,
				}
				: {
					text: `$(alert) ${vscode.l10n.t("Select Data Connection")}`,
					tooltip: hover(
						vscode.l10n.t("No data connection chosen"),
						vscode.l10n.t("Click to say which data connection this file is written against; until then only SQL keywords are completed."),
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
		// Escaped: the heading can be a connection's name, which is the user's to choose and may
		// well hold an underscore, an asterisk or brackets.
		`**${escapeMarkdown(heading)}**`,
		detail,
		vscode.l10n.t("SQL dialect: {0}", shown),
	].join('\n\n'));
}

/**
 * A connection's name as status bar text, which reads `$(name)` as an icon. Escaped so that a name
 * holding one is shown as typed.
 */
function escapeIcons(name: string): string {
	return name.replace(/\$\(/g, '\\$(');
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
 * Offers every SQL connection the user has set up, open or not, and only one of them can be
 * chosen: a statement runs against one database. A closed one is marked as such, and choosing it
 * opens it -- a connection just added in the Data Connections pane is closed, and is the one the
 * user is most likely looking for.
 *
 * When none is set up it says so in a notification and returns undefined straight away, without
 * waiting for the user to answer it. A notification's answer only arrives when the user clicks it
 * or clears it from the notification center -- not when the toast hides itself -- and a caller may
 * be holding a guard while it awaits this, as running a statement does. Waiting would leave every
 * later run doing nothing until the user went looking for a notification they had stopped seeing.
 *
 * Above them is the way back to having chosen nothing, where the file follows the only open
 * connection: without it, a file once scoped could only be unscoped by deleting the connection.
 *
 * @param configured Every SQL connection the user has set up, which is what is offered.
 * @param open The connections the schema was last read from, so a closed one can be marked.
 * @param current What the file is scoped to now, shown as picked.
 * @returns The connection chosen, {@link AUTOMATIC} to drop the file's choice, or undefined if
 *   the user dismissed the picker or there was nothing to pick.
 */
export async function pickConnection(
	configured: readonly ConnectionRef[],
	open: readonly ConnectionRef[],
	current: ConnectionRef | undefined,
): Promise<ConnectionRef | typeof AUTOMATIC | undefined> {
	if (configured.length === 0) {
		// Nothing to choose between. Offering an empty list would leave the user to work out that
		// the answer is somewhere else entirely. Worded for both callers: this is reached when
		// scoping a file's completions and when running one of its statements.
		const connect = vscode.l10n.t("Open the Data Connections Pane");
		void Promise.resolve(vscode.window.showInformationMessage(
			vscode.l10n.t("No data connection is set up. Add one in the Data Connections pane to use it with this file."),
			connect,
		)).then(async answer => {
			if (answer === connect) {
				await vscode.commands.executeCommand('workbench.panel.positronDataConnections.focus');
			}
		}).catch(() => {
			// The notification is a hint, not the result: there is nothing to do if it, or the
			// pane it opens, fails.
		});
		return undefined;
	}

	// Closed connections are offered too, and marked: choosing one opens it. A connection the user
	// has just added in the pane is closed, and is the one they are most likely looking for.
	const items: ConnectionItem[] = configured.map(connection => {
		const isCurrent = connection.profileId === current?.profileId;
		const isOpen = open.some(candidate => candidate.profileId === connection.profileId);
		return {
			label: connection.name,
			description: [
				isCurrent ? vscode.l10n.t("Current") : undefined,
				isOpen ? undefined : vscode.l10n.t("Not connected"),
			].filter(Boolean).join(', ') || undefined,
			picked: isCurrent,
			connection,
		};
	});

	const automatic: ConnectionItem = {
		label: vscode.l10n.t("Automatic"),
		description: [
			current ? undefined : vscode.l10n.t("Current"),
			open.length === 1
				? vscode.l10n.t("The only open data connection, {0}", open[0].name)
				: vscode.l10n.t("The only open data connection, when one is open"),
		].filter(Boolean).join(', '),
		picked: !current,
		connection: AUTOMATIC,
	};

	const picked = await vscode.window.showQuickPick<ConnectionItem>([
		automatic,
		{ label: '', kind: vscode.QuickPickItemKind.Separator, connection: AUTOMATIC },
		...items,
	], {
		title: vscode.l10n.t("Select Data Connection"),
		placeHolder: vscode.l10n.t("Which database is this file written against?"),
	});
	return picked?.connection;
}

/**
 * Says that Data Connections is off, in place of a picker with nothing in it, and offers the setting.
 *
 * The status bar item is hidden then, but the command can still be run from the Command Palette
 * or a keybinding, and should not do nothing.
 *
 * Not awaited, for the reason {@link pickConnection} gives for its own notification.
 */
export function explainDataConnectionsOff(): void {
	const openSetting = vscode.l10n.t("Open Setting");
	void Promise.resolve(vscode.window.showInformationMessage(
		vscode.l10n.t("Data Connections is turned off. Turn on the dataConnections.enabled setting to use a data connection with this file."),
		openSetting,
	)).then(async answer => {
		if (answer === openSetting) {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'dataConnections.enabled');
		}
	}).catch(() => {
		// A hint, not the result.
	});
}

/** What the picker returns for its first item, which drops the file's choice. */
export const AUTOMATIC = 'automatic';

interface ConnectionItem extends vscode.QuickPickItem {
	readonly connection: ConnectionRef | typeof AUTOMATIC;
}
