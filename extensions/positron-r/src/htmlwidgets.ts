/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';

/**
 * Represents an HTML dependency of an R HTML widget. This data structure is a
 * JSON-serialized form of the htmltools::htmlDependency R object.
 */
export interface RHtmlDependency {
	all_files: boolean; // eslint-disable-line
	head: string | null;
	meta: string | null;
	name: string | null;
	script: string | string[] | null;
	src: {
		file: string;
	};
	stylesheet: string | string[] | null;
	version: string | null;
}


/**
 * Represents a sizing policy for an R HTML widget.
 *
 * Sizing policies are JSON-serialized forms of htmlwidgets::sizingPolicy; read
 * more about HTML widget sizing policies here:
 *
 * https://www.htmlwidgets.org/develop_sizing.html
 */
export interface WidgetSizingPolicy {
	/** The default height, in CSS units (e.g. "100%") */
	defaultHeight: string | null;

	/** The default width, in CSS units (e.g. "100%") */
	defaultWidth: string | null;

	/** Whether to fill the viewport */
	fill: boolean | null;

	/** Additional padding to apply */
	padding: number | null;
}

/**
 * A sizing policy specific to the viewer pane.
 */
export interface ViewerSizingPolicy extends WidgetSizingPolicy {
	/** The desired height of the Viewer pane, in CSS pixels */
	paneHeight: number | null;

	/** The desired height of the Viewer pane, in CSS pixels */
	suppress: boolean | null;
}

/**
 * A sizing policy specific to browsers.
 */
export interface BrowserSizingPolicy extends WidgetSizingPolicy {
	/** Whether the widget should be displayed in an external browser. */
	external: boolean | null;
}

/**
 * A sizing policy specific to knitr (notebook-like) environments.
 */
export interface KnitrSizingPolicy extends WidgetSizingPolicy {
	figure: boolean | null;
}

/**
 * The top-level sizing policy for an R HTML widget.
 */
export interface HtmlWidgetSizingPolicy extends WidgetSizingPolicy {
	viewer: ViewerSizingPolicy;
	browser: BrowserSizingPolicy;
	knitr: KnitrSizingPolicy;
}

/**
 * Represents an R HTML widget.
 */
export interface RHtmlWidget {
	dependencies: RHtmlDependency[];
	// eslint-disable-next-line
	sizing_policy: HtmlWidgetSizingPolicy;
	tags: string;
}

/**
 * Get the resource roots for R HTML widgets.
 */
export function getResourceRoots(widget: RHtmlWidget) {
	const roots: Uri[] = [];

	// Mark each dependency as a local resource root.
	widget.dependencies.forEach((dep: RHtmlDependency) => {
		if (dep.src.file) {
			roots.push(Uri.file(dep.src.file));
		}
	});

	// Remove duplicates.
	return Array.from(new Set(roots));

	return roots;
}
