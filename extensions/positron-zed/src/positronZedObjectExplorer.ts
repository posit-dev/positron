/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { JsonRpcErrorCode } from './jsonrpc';
import { ZedVariable } from './positronZedVariables';

/**
 * The most nodes a search visits before it stops early.
 */
const SEARCH_NODE_BUDGET = 200_000;

/**
 * The kinds of node the object explorer comm understands.
 */
const OBJECT_NODE_KINDS = new Set([
	'boolean', 'bytes', 'class', 'collection', 'empty', 'function', 'map',
	'number', 'other', 'string', 'table', 'lazy', 'connection'
]);

/**
 * A node of an explored object, as sent over the object explorer comm.
 */
interface ObjectNode {
	access_key: string;
	display_name: string;
	display_type: string;
	display_value: string;
	kind: string;
	length: number;
	has_children: boolean;
	is_truncated: boolean;
	is_cycle: boolean;
	accessor?: string;
}

/**
 * A row of search results, as sent over the object explorer comm.
 */
interface SearchRow {
	path: string[];
	node: ObjectNode;
	match_kind: 'ancestor' | 'name' | 'value' | 'name_and_value';
}

/**
 * Thrown for requests whose parameters don't make sense.
 */
class InvalidParamsError extends Error { }

/**
 * A Zed object explorer: serves one Zed variable to Positron's Object Explorer over the
 * object explorer comm.
 */
export class ZedObjectExplorer {
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	readonly onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	readonly id = randomUUID();

	/**
	 * Constructor.
	 * @param title The title of the explored variable.
	 * @param variablePath The variables comm path of the explored variable.
	 * @param resolveRoot Resolves the explored variable, which is replaced when it is updated.
	 * @param openObjectExplorer Opens another object explorer on the same variable and returns
	 * its ID.
	 */
	constructor(
		readonly title: string,
		readonly variablePath: string[],
		private readonly resolveRoot: () => ZedVariable | undefined,
		private readonly openObjectExplorer: () => string
	) { }

	/**
	 * Handles a request from the front end.
	 * @param message The JSON-RPC request.
	 */
	handleMessage(message: any): void {
		try {
			this._onDidEmitData.fire({ jsonrpc: '2.0', result: this.handleRequest(message.method, message.params ?? {}) });
		} catch (err) {
			this._onDidEmitData.fire({
				jsonrpc: '2.0',
				error: {
					code: err instanceof InvalidParamsError ? JsonRpcErrorCode.INVALID_PARAMS : JsonRpcErrorCode.INTERNAL_ERROR,
					message: err instanceof Error ? err.message : String(err)
				}
			});
		}
	}

	private handleRequest(method: string, params: any): unknown {
		switch (method) {
			case 'get_state':
				return { title: this.title, connected: this.resolveRoot() !== undefined };

			case 'get_root':
				return { ...toNode(this.root(), []), display_name: this.title, accessor: this.title };

			case 'get_children': {
				const parent = this.resolve(params.path);
				const parentAccessor = this.accessorOf(params.path);
				return {
					children: parent.children
						.slice(params.start, params.start + params.limit)
						.map((child, i) => toNode(child, [...params.path, child.access_key], parentAccessor + selector(parent, params.start + i))),
					total: parent.children.length
				};
			}

			case 'search':
				return this.search(String(params.query), params.max_depth, params.max_results);

			case 'format_value':
				return { content: this.resolve(params.path).display_value };

			case 'open_object_explorer':
				return this.openObjectExplorer();

			default:
				throw new InvalidParamsError(`Unknown method: ${method}`);
		}
	}

	private root(): ZedVariable {
		const root = this.resolveRoot();
		if (!root) {
			throw new InvalidParamsError(`${this.title} no longer exists`);
		}
		return root;
	}

	/**
	 * Resolves the variable at a path below the root. Zed access keys are display names.
	 */
	private resolve(path: string[]): ZedVariable {
		let v = this.root();
		for (const key of path) {
			const child = v.children.find(c => c.access_key === key);
			if (!child) {
				throw new InvalidParamsError(`No element ${key} in ${v.display_name}`);
			}
			v = child;
		}
		return v;
	}

	/**
	 * Builds the R-style accessor of the variable at a path below the root.
	 */
	private accessorOf(path: string[]): string {
		let v = this.root();
		let accessor = this.title;
		for (const key of path) {
			const index = v.children.findIndex(c => c.access_key === key);
			if (index < 0) {
				throw new InvalidParamsError(`No element ${key} in ${v.display_name}`);
			}
			accessor += selector(v, index);
			v = v.children[index];
		}
		return accessor;
	}

	/**
	 * Searches names and leaf values, depth first, returning matches and their ancestors.
	 */
	private search(query: string, maxDepth: number, maxResults: number) {
		const needle = query.toLowerCase();
		const rows: SearchRow[] = [];
		const ancestors: { path: string[]; node: ObjectNode; emitted: boolean }[] = [];
		let matches = 0;
		let visited = 0;
		let truncated = false;

		const visit = (v: ZedVariable, path: string[], accessor: string): boolean => {
			if (visited >= SEARCH_NODE_BUDGET || matches >= maxResults) {
				truncated = true;
				return true;
			}
			visited++;

			const node = toNode(v, path, accessor);
			const nameMatch = node.display_name.toLowerCase().includes(needle);
			const valueMatch = !node.has_children && node.display_value.toLowerCase().includes(needle);
			if (nameMatch || valueMatch) {
				for (const ancestor of ancestors) {
					if (!ancestor.emitted) {
						rows.push({ path: ancestor.path, node: ancestor.node, match_kind: 'ancestor' });
						ancestor.emitted = true;
					}
				}
				rows.push({ path, node, match_kind: nameMatch && valueMatch ? 'name_and_value' : nameMatch ? 'name' : 'value' });
				matches++;
			}

			if (path.length >= maxDepth || !node.has_children) {
				return false;
			}
			ancestors.push({ path, node, emitted: nameMatch || valueMatch });
			try {
				return v.children.some((child, i) => visit(child, [...path, child.access_key], accessor + selector(v, i)));
			} finally {
				ancestors.pop();
			}
		};

		const root = this.root();
		root.children.some((child, i) => visit(child, [child.access_key], this.title + selector(root, i)));
		return { rows, total_matches: matches, truncated };
	}
}

/**
 * Builds the R-style selector of a container's child: `[["name"]]` in a map, `[[i]]` in a list.
 */
function selector(container: ZedVariable, index: number): string {
	return container.kind === 'map' ?
		`[[${JSON.stringify(container.children[index].display_name)}]]` :
		`[[${index + 1}]]`;
}

/**
 * Builds the object explorer node for a Zed variable.
 */
function toNode(v: ZedVariable, path: string[], accessor?: string): ObjectNode {
	return {
		access_key: path.length > 0 ? v.access_key : '',
		display_name: v.display_name,
		display_type: v.display_type,
		display_value: v.display_value,
		kind: OBJECT_NODE_KINDS.has(v.kind) ? v.kind : 'other',
		length: v.has_children ? v.children.length : v.length,
		has_children: v.has_children,
		is_truncated: v.is_truncated,
		is_cycle: false,
		accessor
	};
}
