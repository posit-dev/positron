/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ChildrenResult, FormattedValue, ObjectExplorerState, ObjectNode, SearchResult } from '../../languageRuntime/common/positronObjectExplorerComm.js';

export type { ChildrenResult, FormattedValue, ObjectExplorerState, ObjectNode, SearchResult, SearchRow } from '../../languageRuntime/common/positronObjectExplorerComm.js';
export { ObjectNodeKind, SearchRowMatchKind } from '../../languageRuntime/common/positronObjectExplorerComm.js';

/**
 * A source of object explorer data: a runtime comm, or an in-process file backend.
 */
export interface IObjectExplorerBackend extends IDisposable {
	/**
	 * The comm id, or `json:<uri>` for file backends.
	 */
	readonly identifier: string;

	/**
	 * Fired when the explored object changed; the UI reloads every loaded level.
	 */
	readonly onDidUpdate: Event<void>;

	/**
	 * Fired once when the backend goes away (comm closed, file deleted).
	 */
	readonly onDidClose: Event<void>;

	getState(): Promise<ObjectExplorerState>;
	getRoot(): Promise<ObjectNode>;
	getChildren(path: string[], start: number, limit: number): Promise<ChildrenResult>;
	search(query: string, maxDepth: number, maxResults: number): Promise<SearchResult>;
	formatValue(path: string[], maxLength?: number): Promise<FormattedValue>;

	/**
	 * Opens a full object explorer on the same object and returns its identifier. Only runtime
	 * backends implement this.
	 */
	openObjectExplorer?(): Promise<string>;

	/**
	 * Opens a Data Explorer on the table at a path and returns its identifier. Only runtime
	 * backends implement this.
	 */
	viewTable?(path: string[], title: string): Promise<string>;
}
