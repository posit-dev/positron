/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomPositronLayoutDescription, KnownPositronLayoutParts } from '../../common/positronCustomViews.js';

/**
 * What the window looks like right now, as far as matching a layout needs to know.
 */
export interface LayoutState {
	/** Whether the part is on screen. */
	isPartVisible(part: KnownPositronLayoutParts): boolean;
	/** The part a view container is in, or undefined when it is somewhere else or not registered. */
	partOfContainer(containerId: string): KnownPositronLayoutParts | undefined;
	/** The id of the view container a view is in, or undefined when the view is not registered. */
	containerOfView(viewId: string): string | undefined;
	/** Whether a view container holds any views, shown or not. */
	containerHasViews(containerId: string): boolean;
}

/**
 * A layout that can be matched against the window: its command id and its description.
 */
export interface MatchableLayout {
	readonly id: string;
	readonly layoutDescriptor: CustomPositronLayoutDescription;
}

/**
 * Whether the window has the shape a layout describes. Sizes and order are ignored:
 * each part must be shown or hidden as the layout says, and every view container and
 * view the layout places must be where it put them. A container the layout places
 * without naming its views must still have views in it: a container keeps its place
 * after its views move elsewhere, and an empty one does not show. Views the layout
 * does not mention can be anywhere.
 * @param layout The layout description to check.
 * @param state What the window looks like now.
 * @returns True when the window matches the layout.
 */
export function layoutMatches(layout: CustomPositronLayoutDescription, state: LayoutState): boolean {
	for (const part of Object.keys(layout) as KnownPositronLayoutParts[]) {
		const description = layout[part];
		// A part that hides itself when the window is too narrow can be either way.
		if (!description.hideIfBelowMinSize && state.isPartVisible(part) === description.hidden) {
			return false;
		}
		for (const container of description.viewContainers ?? []) {
			if (state.partOfContainer(container.id) !== part) {
				return false;
			}
			if (!container.views && !state.containerHasViews(container.id)) {
				return false;
			}
			for (const view of container.views ?? []) {
				if (state.containerOfView(view.id) !== container.id) {
					return false;
				}
			}
		}
	}
	return true;
}

/**
 * Finds the named layout the window is in.
 * @param layouts The layouts to check, in order of preference.
 * @param state What the window looks like now.
 * @param currentLayoutId The layout the window was last in. It wins when it still matches,
 * because two layouts can have the same shape.
 * @returns The id of the matching layout, or undefined when none match.
 */
export function findMatchingLayout(
	layouts: readonly MatchableLayout[],
	state: LayoutState,
	currentLayoutId: string | undefined,
): string | undefined {
	const matches = layouts.filter(layout => layoutMatches(layout.layoutDescriptor, state));
	return matches.find(layout => layout.id === currentLayoutId)?.id ?? matches[0]?.id;
}

const matchableLayouts: MatchableLayout[] = [];

/**
 * Adds a layout to the ones the layout service matches the window against. Only layouts
 * that place at least one view container are kept: a layout that only shows and hides
 * parts, like Maximized Sidebar, would match too many windows to mean anything.
 * @param layout The layout to add.
 */
export function registerMatchableLayout(layout: MatchableLayout): void {
	const placesContainers = Object.values(layout.layoutDescriptor)
		.some(part => (part.viewContainers?.length ?? 0) > 0);
	if (placesContainers) {
		matchableLayouts.push(layout);
	}
}

/**
 * The layouts the layout service matches the window against, in the order they registered.
 */
export function getMatchableLayouts(): readonly MatchableLayout[] {
	return matchableLayouts;
}
