/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ChildrenResult, FormattedValue, IObjectExplorerBackend, ObjectExplorerState, ObjectNode, ObjectNodeKind, SearchResult, SearchRow, SearchRowMatchKind } from './objectExplorerBackend.js';

/**
 * The most nodes a search visits before it stops early.
 */
const SEARCH_NODE_BUDGET = 200_000;

/**
 * The longest a display value gets before it is truncated.
 */
const MAX_DISPLAY_VALUE_LENGTH = 128;

/**
 * The most entries of a container shown in its display value.
 */
const MAX_DISPLAY_VALUE_ENTRIES = 20;

/**
 * A parsed JSON value.
 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * An object explorer backend over a parsed JSON value, such as the contents of a JSON file.
 */
export class JsonObjectExplorerBackend extends Disposable implements IObjectExplorerBackend {
	private readonly _onDidUpdateEmitter = this._register(new Emitter<void>());
	private readonly _onDidCloseEmitter = this._register(new Emitter<void>());

	readonly onDidUpdate = this._onDidUpdateEmitter.event;
	readonly onDidClose = this._onDidCloseEmitter.event;

	/**
	 * Constructor.
	 * @param identifier The identifier, `json:<file uri>` for files.
	 * @param _title The title of the value, such as the file name.
	 * @param _root The value.
	 */
	constructor(
		readonly identifier: string,
		private readonly _title: string,
		private _root: unknown
	) {
		super();
	}

	/**
	 * Replaces the value and notifies listeners.
	 * @param root The new value.
	 */
	setRoot(root: unknown): void {
		this._root = root;
		this._onDidUpdateEmitter.fire();
	}

	/**
	 * Notifies listeners that the value is gone.
	 */
	close(): void {
		this._onDidCloseEmitter.fire();
	}

	async getState(): Promise<ObjectExplorerState> {
		return { title: this._title, connected: true };
	}

	async getRoot(): Promise<ObjectNode> {
		return formatJsonNode('', this._title, this._root as JsonValue, '$');
	}

	async getChildren(path: string[], start: number, limit: number): Promise<ChildrenResult> {
		const { value: parent, accessor } = this.resolve(path);
		const entries = childEntries(parent);
		return {
			children: entries.slice(start, start + limit).map(([key, displayName, value]) =>
				formatJsonNode(key, displayName, value, accessor + childAccessor(key, parent))),
			total: entries.length
		};
	}

	async search(query: string, maxDepth: number, maxResults: number): Promise<SearchResult> {
		const needle = query.toLocaleLowerCase();
		const rows: SearchRow[] = [];
		let matches = 0;
		let visited = 0;
		let truncated = false;

		// The ancestors of the node being visited, below the root, and whether each was emitted.
		const ancestors: { path: string[]; node: ObjectNode; emitted: boolean }[] = [];

		// Visits a node and its descendants; returns true when the search must stop.
		const visit = (value: JsonValue, path: string[], node: ObjectNode): boolean => {
			if (visited >= SEARCH_NODE_BUDGET || matches >= maxResults) {
				truncated = true;
				return true;
			}
			visited++;

			const matchKind = searchMatchKind(node, needle);
			if (matchKind !== undefined) {
				for (const ancestor of ancestors) {
					if (!ancestor.emitted) {
						rows.push({ path: ancestor.path, node: ancestor.node, match_kind: SearchRowMatchKind.Ancestor });
						ancestor.emitted = true;
					}
				}
				rows.push({ path, node, match_kind: matchKind });
				matches++;
			}

			if (path.length >= maxDepth || !node.has_children) {
				return false;
			}

			ancestors.push({ path, node, emitted: matchKind !== undefined });
			try {
				for (const [key, displayName, child] of childEntries(value)) {
					const childNode = formatJsonNode(key, displayName, child, (node.accessor ?? '') + childAccessor(key, value));
					if (visit(child, [...path, key], childNode)) {
						return true;
					}
				}
				return false;
			} finally {
				ancestors.pop();
			}
		};

		const root = this._root as JsonValue;
		for (const [key, displayName, child] of childEntries(root)) {
			if (visit(child, [key], formatJsonNode(key, displayName, child, '$' + childAccessor(key, root)))) {
				break;
			}
		}

		return { rows, total_matches: matches, truncated };
	}

	async formatValue(path: string[], maxLength?: number): Promise<FormattedValue> {
		const { value } = this.resolve(path);
		const content = typeof value === 'string' ? value :
			value !== null && typeof value === 'object' ? JSON.stringify(value, undefined, 2) :
				String(value);
		return maxLength !== undefined && content.length > maxLength ?
			{ content: content.substring(0, maxLength), is_truncated: true } :
			{ content, is_truncated: false };
	}

	/**
	 * Resolves the value at a path, and its accessor.
	 */
	private resolve(path: string[]): { value: JsonValue; accessor: string } {
		let value = this._root as JsonValue;
		let accessor = '$';
		for (const key of path) {
			accessor += childAccessor(key, value);
			if (Array.isArray(value)) {
				const index = Number(key);
				if (!Number.isInteger(index) || index < 0 || index >= value.length) {
					throw new Error(`No element at index ${key}.`);
				}
				value = value[index];
			} else if (value !== null && typeof value === 'object' && Object.hasOwn(value, key)) {
				value = value[key];
			} else {
				throw new Error(`No value named ${key}.`);
			}
		}
		return { value, accessor };
	}
}

/**
 * Gets the match kind of a node for a search, or undefined if it doesn't match. Values match only
 * on nodes without children, whose display value is the value rather than a summary of children.
 * @param node The node.
 * @param needle The lowercase search text.
 */
function searchMatchKind(node: ObjectNode, needle: string): SearchRowMatchKind | undefined {
	const nameMatch = node.display_name.toLocaleLowerCase().includes(needle);
	const valueMatch = !node.has_children && node.display_value.toLocaleLowerCase().includes(needle);
	if (nameMatch && valueMatch) {
		return SearchRowMatchKind.NameAndValue;
	} else if (nameMatch) {
		return SearchRowMatchKind.Name;
	} else if (valueMatch) {
		return SearchRowMatchKind.Value;
	}
	return undefined;
}

/**
 * Lists the children of a JSON value as [access key, display name, value] triples.
 */
function childEntries(value: JsonValue): [string, string, JsonValue][] {
	if (Array.isArray(value)) {
		return value.map((child, index) => [String(index), `[${index}]`, child]);
	}
	if (value !== null && typeof value === 'object') {
		return Object.entries(value).map(([key, child]) => [key, key, child]);
	}
	return [];
}

/**
 * Gets the JSONPath-style selector of a child within its parent.
 */
function childAccessor(key: string, parent: JsonValue): string {
	return Array.isArray(parent) ? `[${key}]` : `[${JSON.stringify(key)}]`;
}

/**
 * Builds the node for a JSON value.
 * @param key The access key.
 * @param displayName The display name.
 * @param value The value.
 * @param accessor The JSONPath-style accessor.
 */
function formatJsonNode(key: string, displayName: string, value: JsonValue, accessor: string): ObjectNode {
	const [displayType, kind] = jsonType(value);
	const length = Array.isArray(value) ? value.length :
		value !== null && typeof value === 'object' ? Object.keys(value).length : 0;
	const [displayValue, isTruncated] = truncate(jsonDisplayValue(value, 0));
	return {
		access_key: key,
		display_name: displayName,
		display_type: kind === ObjectNodeKind.Map || kind === ObjectNodeKind.Collection ? `${displayType} [${length}]` : displayType,
		display_value: displayValue,
		kind,
		length,
		has_children: length > 0,
		is_truncated: isTruncated,
		is_cycle: false,
		accessor
	};
}

/**
 * Gets the display type and kind of a JSON value.
 */
function jsonType(value: JsonValue): [string, ObjectNodeKind] {
	if (value === null) {
		return ['null', ObjectNodeKind.Empty];
	} else if (Array.isArray(value)) {
		return ['array', ObjectNodeKind.Collection];
	}
	switch (typeof value) {
		case 'object':
			return ['object', ObjectNodeKind.Map];
		case 'string':
			return ['string', ObjectNodeKind.String];
		case 'number':
			return ['number', ObjectNodeKind.Number];
		case 'boolean':
			return ['boolean', ObjectNodeKind.Boolean];
		default:
			return [typeof value, ObjectNodeKind.Other];
	}
}

/**
 * Formats a JSON value for display. Containers show their first entries, one level deep.
 * @param value The value.
 * @param level 0 for the value itself, 1 for an entry in a container's display value.
 */
function jsonDisplayValue(value: JsonValue, level: number): string {
	if (Array.isArray(value)) {
		if (level > 0) {
			return value.length > 0 ? '[...]' : '[]';
		}
		const items = value.slice(0, MAX_DISPLAY_VALUE_ENTRIES).map(child => jsonDisplayValue(child, 1));
		return `[${items.join(', ')}${value.length > MAX_DISPLAY_VALUE_ENTRIES ? ', ...' : ''}]`;
	}
	if (value !== null && typeof value === 'object') {
		const keys = Object.keys(value);
		if (level > 0) {
			return keys.length > 0 ? '{...}' : '{}';
		}
		const items = keys.slice(0, MAX_DISPLAY_VALUE_ENTRIES).map(key => `${key}: ${jsonDisplayValue(value[key], 1)}`);
		return `{${items.join(', ')}${keys.length > MAX_DISPLAY_VALUE_ENTRIES ? ', ...' : ''}}`;
	}
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Truncates a display value to the maximum length.
 * @returns The display value and whether it was truncated.
 */
function truncate(text: string): [string, boolean] {
	if (text.length <= MAX_DISPLAY_VALUE_LENGTH) {
		return [text, false];
	}
	return [`${text.substring(0, MAX_DISPLAY_VALUE_LENGTH - 3)}...`, true];
}
