/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
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
 * Represents an R HTML widget.
 */
export interface RHtmlWidget {
	dependencies: RHtmlDependency[];
	tags: string;
}

/**
 * Register a local resource roots provider for R HTML widgets.
 */
export function registerHtmlWidgets() {
	positron.runtime.registerLocalResourceRootsProvider({
		mimeType: 'application/vnd.r.htmlwidget',
		callback: (data) => {
			const widget = data as RHtmlWidget;
			const roots: Uri[] = [];

			// Mark each dependency as a local resource root.
			widget.dependencies.forEach((dep: RHtmlDependency) => {
				if (dep.src.file) {
					roots.push(Uri.file(dep.src.file));
				}
			});

			return roots;
		}
	}
	);
}
