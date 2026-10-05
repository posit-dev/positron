/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from object_explorer.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * The state of an object explorer
 */
export interface ObjectExplorerState {
	/**
	 * Title for the editor tab, usually the variable name or expression that
	 * was viewed
	 */
	title: string;

	/**
	 * False when the explored object no longer exists; the frontend shows a
	 * disconnected state
	 */
	connected: boolean;

	/**
	 * Optional message explaining why the explorer is disconnected
	 */
	error_message?: string;

}

/**
 * A page of child nodes
 */
export interface ChildrenResult {
	/**
	 * The requested page of children, in the object's natural order
	 */
	children: Array<ObjectNode>;

	/**
	 * Total number of children the parent has (may exceed the number
	 * returned)
	 */
	total: number;

}

/**
 * Search results
 */
export interface SearchResult {
	/**
	 * Matches and their ancestors in pre-order
	 */
	rows: Array<SearchRow>;

	/**
	 * Number of matching nodes in 'rows'
	 */
	total_matches: number;

	/**
	 * True if the search stopped early because max_results or the node
	 * budget was reached
	 */
	truncated: boolean;

}

/**
 * A value formatted for the clipboard
 */
export interface FormattedValue {
	/**
	 * The formatted value
	 */
	content: string;

}

/**
 * One node in the explored object
 */
export interface ObjectNode {
	/**
	 * The path segment that selects this node within its parent; same
	 * semantics as the variables comm
	 */
	access_key: string;

	/**
	 * The node's name (key, index, slot, or attribute), formatted for
	 * display
	 */
	display_name: string;

	/**
	 * The node's type, formatted for display using the same formatter as the
	 * variables comm
	 */
	display_type: string;

	/**
	 * The node's value, formatted for display and possibly truncated, using
	 * the same formatter as the variables comm
	 */
	display_value: string;

	/**
	 * The kind of value, using the same vocabulary as the variables comm
	 */
	kind: ObjectNodeKind;

	/**
	 * The number of children or elements, if known; 0 otherwise
	 */
	length: number;

	/**
	 * Whether get_children would return anything for this node
	 */
	has_children: boolean;

	/**
	 * True if display_value is a truncated representation
	 */
	is_truncated: boolean;

	/**
	 * True if this node is the same object as one of its ancestors; such
	 * nodes never report children
	 */
	is_cycle: boolean;

	/**
	 * A language expression that evaluates to this node's value. Absent when
	 * no expression exists.
	 */
	accessor?: string;

}

/**
 * A row in a search result: a match or an ancestor of a match
 */
export interface SearchRow {
	/**
	 * Access keys from the root to this node
	 */
	path: Array<string>;

	/**
	 * The node at this path
	 */
	node: ObjectNode;

	/**
	 * Which field matched; 'ancestor' for ancestors included only for
	 * context
	 */
	match_kind: SearchRowMatchKind;

}

/**
 * Possible values for Kind in ObjectNode
 */
export enum ObjectNodeKind {
	Boolean = 'boolean',
	Bytes = 'bytes',
	Class = 'class',
	Collection = 'collection',
	Empty = 'empty',
	Function = 'function',
	Map = 'map',
	Number = 'number',
	Other = 'other',
	String = 'string',
	Table = 'table',
	Lazy = 'lazy',
	Connection = 'connection'
}

/**
 * Possible values for MatchKind in SearchRow
 */
export enum SearchRowMatchKind {
	Ancestor = 'ancestor',
	Name = 'name',
	Value = 'value',
	NameAndValue = 'name_and_value'
}

/**
 * Parameters for the GetChildren method.
 */
export interface GetChildrenParams {
	/**
	 * Access keys from the root to the parent node; [] is the root
	 */
	path: Array<string>;

	/**
	 * Zero-based index of the first child to return
	 */
	start: number;

	/**
	 * Maximum number of children to return
	 */
	limit: number;
}

/**
 * Parameters for the Search method.
 */
export interface SearchParams {
	/**
	 * The text to search for
	 */
	query: string;

	/**
	 * Maximum depth below the root to descend (root children are depth 1)
	 */
	max_depth: number;

	/**
	 * Maximum number of matching nodes to return
	 */
	max_results: number;
}

/**
 * Parameters for the FormatValue method.
 */
export interface FormatValueParams {
	/**
	 * Access keys from the root to the node
	 */
	path: Array<string>;
}

/**
 * Event: The explored object changed
 */
export interface UpdateEvent {
}

export enum ObjectExplorerFrontendEvent {
	Update = 'update'
}

export enum ObjectExplorerBackendRequest {
	GetState = 'get_state',
	GetRoot = 'get_root',
	GetChildren = 'get_children',
	Search = 'search',
	FormatValue = 'format_value',
	OpenObjectExplorer = 'open_object_explorer'
}

export class PositronObjectExplorerComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<ObjectExplorerBackendRequest>,
	) {
		super(instance, options);
		this.onDidUpdate = super.createEventEmitter('update', []);
	}

	/**
	 * Get the explorer state
	 *
	 * Returns the title and connection state of the explored object. Used on
	 * first open and when reconnecting to an existing comm.
	 *
	 *
	 * @returns The state of an object explorer
	 */
	getState(): Promise<ObjectExplorerState> {
		return super.performRpc('get_state', [], []);
	}

	/**
	 * Get the root node
	 *
	 * Returns the node describing the explored object itself (path []).
	 *
	 *
	 * @returns undefined
	 */
	getRoot(): Promise<ObjectNode> {
		return super.performRpc('get_root', [], []);
	}

	/**
	 * Get one page of a node's children
	 *
	 * Returns up to 'limit' children of the node at 'path', starting at
	 * child index 'start'. Never descends more than one level.
	 *
	 * @param path Access keys from the root to the parent node; [] is the
	 * root
	 * @param start Zero-based index of the first child to return
	 * @param limit Maximum number of children to return
	 *
	 * @returns A page of child nodes
	 */
	getChildren(path: Array<string>, start: number, limit: number): Promise<ChildrenResult> {
		return super.performRpc('get_children', ['path', 'start', 'limit'], [path, start, limit]);
	}

	/**
	 * Search names and values
	 *
	 * Depth-first, case-insensitive substring search over node display
	 * names, and over the display values of leaves (nodes that are neither
	 * containers nor cycles), bounded by max_depth and an internal node
	 * budget. Returns matches and every ancestor of a match, in pre-order,
	 * so the frontend can render the results as a tree.
	 *
	 * @param query The text to search for
	 * @param maxDepth Maximum depth below the root to descend (root children
	 * are depth 1)
	 * @param maxResults Maximum number of matching nodes to return
	 *
	 * @returns Search results
	 */
	search(query: string, maxDepth: number, maxResults: number): Promise<SearchResult> {
		return super.performRpc('search', ['query', 'max_depth', 'max_results'], [query, maxDepth, maxResults]);
	}

	/**
	 * Format a node's full value for the clipboard
	 *
	 * Returns the complete (untruncated, within reason) plain-text
	 * representation of the node at 'path'.
	 *
	 * @param path Access keys from the root to the node
	 *
	 * @returns A value formatted for the clipboard
	 */
	formatValue(path: Array<string>): Promise<FormattedValue> {
		return super.performRpc('format_value', ['path'], [path]);
	}

	/**
	 * Open a full object explorer for an inline explorer
	 *
	 * Asks the backend to open a new, non-inline object explorer comm on the
	 * same object. Returns the new comm id.
	 *
	 *
	 * @returns The comm id of the newly opened object explorer
	 */
	openObjectExplorer(): Promise<string> {
		return super.performRpc('open_object_explorer', [], []);
	}


	/**
	 * The explored object changed
	 *
	 * Sent after the backend detects that the explored object was reassigned
	 * or otherwise changed. The frontend re-fetches every loaded level,
	 * preserving expansion.
	 */
	onDidUpdate: Event<UpdateEvent>;
}

