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

	// Whether this node's children render at its own indent rather than one step further in. For a
	// node that names a category rather than a thing -- "Tables", "Columns" -- the extra step buys
	// nothing: the row above already says what the rows below are. The node keeps its twisty and
	// its place in the structure; only the indent of what it holds changes. Defaults to false.
	readonly flattensChildren?: boolean;
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

	// Structural depth: how many ancestors the node has. Drives navigation (which row is a given
	// row's parent, which row is its first child) and is what any hierarchy an assistive technology
	// is told about must be derived from.
	readonly depth: number;

	// Visual indent step. Equal to depth until some ancestor sets flattensChildren, after which it
	// trails depth by one step per such ancestor. Only the rendered indent uses this -- keeping it
	// apart from depth is what lets a category row hold its children at its own indent without the
	// tree losing track of who is whose parent.
	readonly indentLevel: number;

	// Whether this row draws an extra indent guide for the parent it shares a step with. A node that
	// sets flattensChildren gives up the step a guide would normally be drawn in, so without this
	// there is no line marking what its children belong to.
	//
	// Set only when every one of those children is a leaf. A child with a twisty of its own has it at
	// the same x as the line -- they share an indent step -- and the line would run through the
	// chevrons instead of beside them.
	readonly flattenedParentGuide: boolean;

	readonly expandState: TreeExpandState;

	// Whether a reload of this node's subtree is in flight. Deliberately separate from
	// expandState: a reload swaps the subtree in place, so the current (stale) children stay on
	// screen throughout and only the twisty reflects that work is happening.
	readonly refreshing: boolean;

	// Whether this row was part of a reload that just landed -- either the reloaded node itself or
	// one of the rows brought in beneath it. True only for a moment after the swap, so the
	// refreshed block can call attention to itself; a reload that returns identical data is
	// otherwise indistinguishable from nothing having happened.
	readonly recentlyRefreshed: boolean;

	// Whether an ancestor of this row has a reload in flight. The row is still on screen -- a
	// reload doesn't tear its subtree down before the replacement arrives -- but it is about to be
	// replaced, and any per-fetch resource it carries may already have been released by the
	// ancestor's own fetch. Consumers should suppress actions on a stale row rather than let the
	// user operate on something that is on its way out.
	readonly stale: boolean;

	// Which reload marked this row, or 0 when it isn't marked. Rows use the parity to alternate
	// between two otherwise identical highlight animations, because a CSS animation only restarts
	// when its animation-name changes -- without that, a row re-marked while its previous run was
	// still going would sit out the new one.
	readonly refreshGeneration: number;
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
