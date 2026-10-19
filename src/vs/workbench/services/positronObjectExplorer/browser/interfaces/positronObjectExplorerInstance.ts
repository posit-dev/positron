/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ObjectExplorerClientInstance } from '../../../languageRuntime/common/languageRuntimeObjectExplorerClient.js';
import { ObjectExplorerColumnWidths, ObjectExplorerSearchResults, ObjectExplorerTreeInstance } from '../../../../browser/positronObjectExplorer/classes/objectExplorerTreeInstance.js';

/**
 * IPositronObjectExplorerInstance interface.
 */
export interface IPositronObjectExplorerInstance {
	/**
	 * The name of the language of the runtime serving the object, or an empty string for files.
	 */
	readonly languageName: string;

	/**
	 * The client for the backend serving the explored object.
	 */
	readonly client: ObjectExplorerClientInstance;

	/**
	 * Whether this instance backs an inline view (e.g. a notebook cell output) whose comm is owned
	 * by the runtime. An editor tab must not dispose the client of an inline instance.
	 */
	readonly isInline: boolean;

	/**
	 * The file the explored object was read from, for file-backed instances.
	 */
	readonly fileUri: URI | undefined;

	/**
	 * Whether the explored object was read from a file.
	 */
	readonly isFileBacked: boolean;

	/**
	 * The title of the explored object.
	 */
	readonly title: string;

	/**
	 * The tree showing the explored object.
	 */
	readonly treeInstance: ObjectExplorerTreeInstance;

	/**
	 * The tree being shown: the search results while searching, else the explored object.
	 */
	readonly activeTreeInstance: ObjectExplorerTreeInstance;

	/**
	 * The column widths shared by the column headers and the trees.
	 */
	readonly columnWidths: ObjectExplorerColumnWidths;

	/**
	 * The search text.
	 */
	readonly searchText: string;

	/**
	 * The results of the current search, if any.
	 */
	readonly searchResults: ObjectExplorerSearchResults | undefined;

	/**
	 * Fires when the title changes.
	 */
	readonly onDidChangeTitle: Event<string>;

	/**
	 * Fires when the explored object goes away.
	 */
	readonly onDidClose: Event<void>;

	/**
	 * Fires when search results arrive or the search is cleared.
	 */
	readonly onDidChangeSearch: Event<void>;

	/**
	 * Fires when focus is requested for the search box.
	 */
	readonly onDidRequestSearchFocus: Event<void>;

	/**
	 * Re-fetches every loaded level of the tree, preserving expansion.
	 */
	refresh(): Promise<void>;

	/**
	 * Opens or activates the editor showing the instance.
	 */
	requestFocus(): void;

	/**
	 * Marks the instance as shown or hidden by one more editor. Reloads are deferred while no
	 * editor shows the instance.
	 * @param visible Whether an editor started or stopped showing the instance.
	 */
	setVisible(visible: boolean): void;

	/**
	 * Sets the search text. The search runs after a pause in typing; empty text clears it.
	 * @param text The search text.
	 */
	setSearchText(text: string): void;

	/**
	 * Clears the search and focuses the tree.
	 */
	clearSearch(): void;

	/**
	 * Requests focus for the search box.
	 */
	focusSearch(): void;

	/**
	 * Copies the full value of the node at the cursor to the clipboard.
	 */
	copyValueAtCursor(): Promise<void>;

	/**
	 * Copies the accessor of the node at the cursor to the clipboard.
	 */
	copyAccessorAtCursor(): Promise<void>;
}
