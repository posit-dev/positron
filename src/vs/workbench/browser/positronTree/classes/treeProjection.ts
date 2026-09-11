/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeExpandState, TreeNode, VisibleNode } from './treeNode.js';

/**
 * TreeProjectionInput type. The structural state required to build the flat projection.
 * Selection / cursor are deliberately absent -- they're applied at render time, not projection
 * time, so the projection only rebuilds when the structure actually changes.
 */
export interface TreeProjectionInput<T> {
	readonly roots: readonly TreeNode<T>[];
	readonly expanded: ReadonlySet<string>;
	readonly loading: ReadonlySet<string>;
	readonly errors: ReadonlyMap<string, unknown>;
	readonly children: ReadonlyMap<string, readonly TreeNode<T>[]>;
	readonly refreshing: ReadonlySet<string>;

	// Recently refreshed node ids, each mapped to the generation of the reload that marked it.
	readonly recentlyRefreshed: ReadonlyMap<string, number>;
}

/**
 * Builds the flat list of visible rows from the structural tree state. Pure function; no
 * dependency on the instance, so it's trivially unit-testable.
 *
 * Walk order: pre-order depth-first. A node appears, then its visible children (only if it's
 * expanded and its children are loaded), then the next sibling, and so on.
 *
 * A node's expandState is computed independently of its children's load state -- the twisty
 * shows what the *user* perceives:
 * - leaf if hasChildren is false (regardless of any stale children entry).
 * - error if an error is recorded for this node, even if children are present.
 * - loading if a fetch is in flight, even if stale children are present.
 * - expanded if the node is in the expanded set.
 * - collapsed otherwise.
 *
 * Children are walked only when the node is `expanded` AND has a children entry. A node in the
 * expanded set whose children have never loaded (e.g. the very first frame after expand() was
 * called) renders with expandState 'loading' and no visible children -- a fetch is in flight
 * or queued, and the next projection rebuild after children arrive will reveal them.
 *
 * A node being reloaded is the exception: it keeps its current expandState (and so its currently
 * loaded children stay on screen) and carries `refreshing` instead, because a reload replaces the
 * subtree in a single commit rather than emptying it first. Everything beneath it is marked
 * `stale` for the duration, since those rows are about to be replaced.
 */
export function buildVisibleNodes<T>(input: TreeProjectionInput<T>): readonly VisibleNode<T>[] {
	const result: VisibleNode<T>[] = [];

	const walk = (
		siblings: readonly TreeNode<T>[],
		depth: number,
		indentLevel: number,
		flattenedParentGuide: boolean,
		stale: boolean
	): void => {
		for (const node of siblings) {
			const expandState = computeExpandState(node, input);
			const refreshGeneration = input.recentlyRefreshed.get(node.id);
			result.push({
				node,
				depth,
				indentLevel,
				flattenedParentGuide,
				expandState,
				refreshing: input.refreshing.has(node.id),
				recentlyRefreshed: refreshGeneration !== undefined,
				refreshGeneration: refreshGeneration ?? 0,
				stale,
			});

			if (expandState === 'expanded') {
				const loaded = input.children.get(node.id);
				if (loaded !== undefined) {
					// Depth always advances -- the children really are one level down, and navigation
					// depends on that. The indent only advances when the node isn't a category row
					// holding its children at its own step.
					//
					// Staleness inherits: everything under a refreshing node is on its way out, so
					// the flag passes down from wherever it was first set. The refreshing node
					// itself is not stale -- it is the one being replaced into, not replaced.
					// A flattening node's children carry the guide marking what they belong to, since
					// the node gave up the step one would normally be drawn in -- but only when they
					// are all leaves. See VisibleNode.flattenedParentGuide.
					const flattens = node.flattensChildren === true;
					walk(
						loaded,
						depth + 1,
						flattens ? indentLevel : indentLevel + 1,
						flattens && loaded.every(child => !child.hasChildren),
						stale || input.refreshing.has(node.id)
					);
				}
			}
		}
	};

	walk(input.roots, 0, 0, false, false);
	return result;
}

function computeExpandState<T>(node: TreeNode<T>, input: TreeProjectionInput<T>): TreeExpandState {
	if (!node.hasChildren) {
		return 'leaf';
	}
	if (input.errors.has(node.id)) {
		return 'error';
	}
	if (input.loading.has(node.id)) {
		return 'loading';
	}
	if (input.expanded.has(node.id)) {
		// In the expanded set but children haven't arrived yet -- treat as loading visually.
		return input.children.has(node.id) ? 'expanded' : 'loading';
	}
	return 'collapsed';
}

/**
 * Finds the index of the parent row for the given visible row index. Returns undefined when
 * the row is a root. Used by left-arrow navigation when the focused row is already collapsed
 * (or a leaf) -- the cursor moves to the parent row.
 *
 * The walk is O(n) in the projection length, which is fine for the row counts the tree is
 * intended for (the projection only contains *visible* rows -- collapsed subtrees don't count).
 */
export function findParentIndex<T>(
	visibleNodes: readonly VisibleNode<T>[],
	rowIndex: number
): number | undefined {
	const target = visibleNodes[rowIndex];
	if (target === undefined || target.depth === 0) {
		return undefined;
	}

	for (let i = rowIndex - 1; i >= 0; i--) {
		if (visibleNodes[i].depth < target.depth) {
			return i;
		}
	}
	return undefined;
}
