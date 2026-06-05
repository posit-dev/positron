/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TreeNode interface. A single node in the tree, supplied by the consumer.
 *
 * The id must be stable across refetches (e.g. 'profile:42/schema:public/table:users'). The
 * instance uses it to preserve expansion, selection, and focus when nodes come back with new
 * object references after a refresh or invalidate.
 */
export interface TreeNode<T> {
	// Stable, unique id across the whole tree.
	readonly id: string;

	// Consumer payload. Opaque to the framework; the renderNode method consumes it.
	readonly data: T;

	// Hint for twisty visibility BEFORE children are fetched. If true, a twisty renders and the
	// row is expandable; if getChildren later returns [], the node falls back to a leaf after
	// expansion. If false, no twisty and expansion is disallowed.
	readonly hasChildren: boolean;
}

/**
 * TreeExpandState type. Describes the visual state of a row's expansion affordance.
 *
 * - leaf: hasChildren is false; no twisty.
 * - collapsed: expandable, children not loaded or not visible. Twisty closed.
 * - expanded: expandable, children loaded and visible. Twisty open.
 * - loading: children fetch is in flight. Spinner in place of twisty.
 * - error: children fetch failed. Error icon in place of twisty; click to retry.
 */
export type TreeExpandState = 'leaf' | 'collapsed' | 'expanded' | 'loading' | 'error';

/**
 * VisibleNode interface. One row in the flat projection the tree renders.
 *
 * Only structural state lives here. Selection / cursor / focus are looked up at render time
 * from the instance, so the projection doesn't have to rebuild on every cursor move.
 */
export interface VisibleNode<T> {
	readonly node: TreeNode<T>;
	readonly depth: number;
	readonly expandState: TreeExpandState;
}

/**
 * TreeNodeContext interface. Passed to the consumer's renderNode method so the rendered row
 * content can react to selection / focus state. Mirrors PositronListItemContext.
 */
export interface TreeNodeContext {
	// The index of the row in the visible projection.
	readonly index: number;

	// Whether the keyboard cursor is on this row.
	readonly cursor: boolean;

	// Whether the tree itself has keyboard focus. Combine with `cursor` to render a focus ring
	// only when the tree is focused.
	readonly treeFocused: boolean;

	// Whether the row is currently selected.
	readonly selected: boolean;
}
