/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Known parts that can be customized in for layouts. This matches the enum `Parts` from
 * `'vs/workbench/services/layout/browser/layoutService'` but can't be imported because it's in a
 * `browser` path.
 */
export type KnownPositronLayoutParts = 'workbench.parts.panel' | 'workbench.parts.sidebar' | 'workbench.parts.auxiliarybar';

type LayoutPixelSize = number;
type LayoutPercentSize = `${number}%`;

/**
 * Description of the custom layout for a given part (e.g. Sidebar, Panel, ...) of the editor.
 */
export type PartLayoutDescription = {
	/**
	 * Size of the part as percent of the viewport size. If the size controls the width or the
	 * height depends on the part. E.g. for the sidebar it's the width.
	 */
	size?: LayoutPercentSize;
	/**
	 * Minimum size of the part in pixels. If the size resolves to a value below this, the part will
	 * be set to this size.
	 */
	minSize?: LayoutPixelSize;
	/**
	 * Maximum size of the part in pixels. If the size resolves to a value above this, the part will
	 * be set to this size.
	 */
	maxSize?: LayoutPixelSize;
	/**
	 * Should the part be hidden if the size resolves to below the `minSize` boundary?
	 */
	hideIfBelowMinSize?: boolean;
	/**
	 * Should this part be hidden by default?
	 */
	hidden: boolean;
	/**
	 * Alignment of the part. Only used for the panel part. Matches `PanelAlignment` type that can't
	 * be imported because its in a `browser` path.
	 */
	alignment?: 'left' | 'center' | 'right' | 'justify';
	/**
	 * Description of the view containers in this part. The order as they appear in the array
	 * will be the order they are shown in the UI. Any non-specified view containers will be
	 * added after the specified ones.
	 */
	viewContainers?: ViewContainerLayoutDescription[];
};

/**
 * Description of a view container within an editor part. E.g. the "Sessions" tab.
 */
type ViewContainerLayoutDescription = {
	/**
	 * Id of this view container. This is the id that the view container is registered with.
	 * E.g. `workbench.panel.positronSession`.
	 */
	id: string;
	/**
	 * Is this view container shown? Only one of these can be shown at a time so if multiple are
	 * set, the last one will be respected.
	 */
	opened?: boolean;
	/**
	 * Description of the views within this view container. The order as they appear in the array
	 * will be the order they are shown in the UI. Any non-specified views will be added after the
	 * specified ones.
	 */
	views?: ViewLayoutDescription[];
};

type ViewLayoutDescription = {
	/**
	 * Id of this view. This is the id that the view is registered with.
	 * E.g. `workbench.panel.positronPlots` or `terminal`.
	 */
	id: string;
	/**
	 * Size units are relative. Every view sharing the same `relativeSize` will have the same size.
	 * If not provided, will default to 1. Is ignored if `collapsed` is set to `true`.
	 */
	relativeSize?: number;
	/**
	 * Should this view be collapsed by default? By default views are expanded. If set to `true`,
	 * the `relativeSize` will be ignored.
	 */
	collapsed?: boolean;
};

/**
 * Full description of custom layout for the editor.
 */
export type CustomPositronLayoutDescription = Record<
	KnownPositronLayoutParts,
	PartLayoutDescription
>;
