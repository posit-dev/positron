/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { basename } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';

/**
 * The driver a database file belongs to: the id the driver registers under, and the name to call
 * it by before it has registered. The name is carried here rather than read from the driver's
 * metadata because the page names the format the moment it opens, while the driver extension may
 * still be activating (see DatabaseFileEditorPage).
 */
export interface IDatabaseFileDriver {
	// The id of the data connection driver that opens this kind of file.
	readonly id: string;

	// The name of the database format, as the driver spells it (e.g. 'DuckDB').
	readonly name: string;
}

// The tab icon. A database file has no live connection behind it yet, so this is the generic
// database glyph rather than the connected-database one the Data Connections tree uses.
const DatabaseFileIcon = ThemeIcon.fromId(Codicon.database.id);

/**
 * DatabaseFileEditorInput class.
 * The input for a database file (e.g. `.duckdb`, `.sqlite`) opened from the Explorer. It carries
 * only the file and the driver that reads it; the connection, if the user asks for one, is created
 * from the page and belongs to the Data Connections service, not to this editor.
 */
export class DatabaseFileEditorInput extends EditorInput {
	//#region Static Properties

	/**
	 * Gets the type ID.
	 */
	static readonly TypeID: string = 'workbench.input.positronDatabaseFile';

	/**
	 * Gets the editor ID.
	 */
	static readonly EditorID: string = 'workbench.editor.positronDatabaseFile';

	//#endregion Static Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param resource The database file.
	 * @param driver The driver that opens this kind of database file.
	 */
	constructor(
		readonly resource: URI,
		readonly driver: IDatabaseFileDriver,
	) {
		super();
	}

	//#endregion Constructor

	//#region EditorInput Overrides

	/**
	 * Gets the type identifier.
	 */
	override get typeId(): string {
		return DatabaseFileEditorInput.TypeID;
	}

	/**
	 * Gets the editor identifier.
	 */
	override get editorId(): string {
		return DatabaseFileEditorInput.EditorID;
	}

	/**
	 * Gets the capabilities of this input. The page displays the file; it never edits it, so it is
	 * readonly and can never be dirty.
	 */
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	/**
	 * Gets the display name of this input, which is the tab's label.
	 */
	override getName(): string {
		return basename(this.resource);
	}

	/**
	 * Gets the icon to display in the editor tab.
	 */
	override getIcon(): ThemeIcon {
		return DatabaseFileIcon;
	}

	/**
	 * Determines whether the other input matches this input.
	 * @param otherInput The other input.
	 */
	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}

		return otherInput instanceof DatabaseFileEditorInput &&
			otherInput.resource.toString() === this.resource.toString();
	}

	//#endregion EditorInput Overrides
}
