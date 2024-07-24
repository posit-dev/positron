/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * This script bridges the worlds of HTML widgets and VS Code notebooks by
 * providing render methods for HTML widgets that conform to VS Code's notebook
 * output renderer API.
 *
 * Its input is a JSON-serialized form of the HTML widget data, which is created in the R
 * kernel by the .ps.view_html_widget() R function.
 */

/**
 * Convert a path to a URI that can be used in a webview. This is effectively a
 * port of `asWebviewUri` from VS Code.
 */
const asWebviewUri = (path) => {
	// Ensure path starts with '/'. On Windows, the path starts with the drive letter, e.g.
	// c/Users/bob/path/to/file.
	if (!path.startsWith('/')) {
		path = '/' + path;
	}
	return 'https://file%2B.vscode-resource.vscode-cdn.net' + path;
};

/**
 * Coerce an object to an array. This is a convenience method for dealing with
 * the fact that HTML widgets can specify dependencies as either a single object
 * or an array of objects.
 *
 * @param obj The object to coerce to an array.
 */
const arrayify = (obj) => {
	if (obj === null || obj === undefined) {
		return [];
	} else if (Array.isArray(obj)) {
		return obj;
	} else {
		return [obj];
	}
};

/**
 * Inject script and style dependencies into the document. The dependencies are
 * a JSON-serialized form of the HTML widget's dependencies, defined with
 * `htmltools::htmlDependency`.
 *
 * @param dependencies The dependencies to inject.
 * @returns A promise that resolves when all scripts have been injected and have
 *  loaded.
 */
const renderDependencies = (dependencies) => {
	// Create a promise that'll resolve when all scripts are loaded;
	// we'll chain to it as we render each dependency.
	let scriptsLoaded = Promise.resolve();

	for (const dep of dependencies) {
		// For now, we only support local file dependencies. HTML widgets
		// can also rely on external libraries, using `href` rather than
		// `file`.
		if (!dep.src.file) {
			continue;
		}

		// Compute the root as a webview URI.
		const root = asWebviewUri(dep.src.file);

		// Add each script.
		arrayify(dep.script).map((file) => {
			// Chain promises so that scripts are appended and loaded sequentially.
			scriptsLoaded = scriptsLoaded.then(() => {
				// Create the script element.
				const script = document.createElement('script');
				script.setAttribute('src', root + '/' + file);

				// Append the script and return a promise that resolves when the script has loaded.
				const scriptLoaded = new Promise(resolve => {
					const handler = () => {
						script.removeEventListener('load', handler);
						resolve();
					};
					script.addEventListener('load', handler);
				});
				document.head.appendChild(script);
				return scriptLoaded;
			});
		});

		// Add each stylesheet.
		arrayify(dep.stylesheet).forEach((file) => {
			const link = document.createElement('link');
			link.setAttribute('rel', 'stylesheet');
			link.setAttribute('href', root + '/' + file);
			document.head.appendChild(link);
		});
	}

	return scriptsLoaded;
};

/**
 * Render HTML tags. These tags define the top-level structure of the widget.
 *
 * @param parent The parent element to render into.
 * @param tags The tags to render. These are JSON-serialized HTML tags;
 *   originally R objects of type `shiny.tag`.
 */
const renderTags = (parent, tags) => {
	for (let i = 0; i < tags.length; i++) {
		const tag = tags[i];

		// Skip null tags.
		if (tag === null) {
			continue;
		}

		// If the tag has a name, render it into an element.
		if (tag.name) {
			// Create the element.
			const ele = document.createElement(tag.name);

			// Set any attributes.
			if (tag.attribs) {
				for (const key in tag.attribs) {
					let val = tag.attribs[key];
					// Some attributes, like `class`, can be arrays. Join them
					// to a single value.
					if (Array.isArray(val)) {
						val = val.join(' ');
					}
					ele.setAttribute(key, tag.attribs[key]);
				}
			}

			// Render any children.
			if (tag.children) {
				if (typeof tag.children[0] === 'string') {
					// A single string child is just a text node.
					ele.innerText = tag.children[0];
				} else {
					// Otherwise, it's a set of tags; recurse.
					renderTags(ele, tag.children[0]);
				}
			}

			// Add the element to the parent.
			parent.appendChild(ele);
		}
	}
};

/**
 * The main VS Code notebook renderer for HTML widgets.
 *
 * @param {*} _context  The context for the widget.
 * @returns A VS Code notebook renderer.
 */
export const activate = (_context) => ({
	renderOutputItem(data, element) {

		// Parse the widget data.
		const widget = data.json();

		// Render the dependencies; once they have all loaded, trigger a static
		// render of the widget.
		renderDependencies(widget.dependencies).then(() => {
			window.HTMLWidgets.staticRender();
		});

		// Render the widget's HTML content.
		renderTags(element, widget.tags);
	},
	disposeOutputItem(id) {
		// No cleanup needed.
	}
});
