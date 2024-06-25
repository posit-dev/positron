/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { HtmlNode, parseHtml } from 'vs/base/common/htmlParser';
import * as React from 'react';


/**
 * Options for rendering HTML to React elements.
 */
interface HTMLRendererOptions {
	/**
	 * Component overrides for the HTML renderer.
	 * Keyed by the node name (e.g. `'img'`) and the value is a component that can replace the
	 * default rendering of that node.
	 */
	componentOverrides?: Record<string, (props: React.PropsWithChildren<React.HTMLAttributes<HTMLElement>>) => React.ReactElement>;
}

/**
 * Renders HTML to React elements.
 *
 * @param html A string of untrusted HTML.
 * @param opts Options for rendering the HTML.
 * @returns A React element containing the rendered HTML.
 */
export const renderHtml = (html: string, opts: HTMLRendererOptions = {}): React.ReactElement => {

	// Parse the HTML into a tree of nodes. This is a very simple-minded parser
	// that finds HTML tags and attributes using regular expressions.
	//
	// Because this code must run in a very strict security context, we cannot
	// use parsers that rely on `innerHTML` or `DOMParser`.
	const parsedContent = parseHtml(html);

	// If there are component over-rides, use those to render the applicable elements.
	function createElement(name: string, attrs: React.DOMAttributes<HTMLElement>, children?: (React.ReactNode | string)[] | React.ReactNode | string) {
		const Component = opts.componentOverrides?.[name] || name;
		return React.createElement(Component, attrs, children);
	}

	// Render the nodes into React elements.
	const renderNode = (node: HtmlNode): React.ReactElement | undefined => {

		// Pull out attributes into a new object so we can add non-string or string-object
		// attributes to it.
		const nodeAttrs: React.DOMAttributes<HTMLElement> = node.attrs || {};

		if (node.type === 'text') {
			// Create <span> elements to host the text content.
			if (node.content && node.content.trim().length > 0) {
				return React.createElement('span', {}, node.content);
			}
			// Text nodes with no content (or only whitespae content) are
			// currently ignored.
			return undefined;
		} else if (node.type === 'tag' && node.children) {
			if (node.children.length === 1 && node.children[0].type === 'text') {
				// If this is a tag with a single text child, create a React element
				// for the tag and its text content.
				return createElement(node.name!, nodeAttrs, node.children[0].content);
			} else {
				if (node.children.length === 0) {
					// If the node has no children, create a React element for
					// the tag. For tags that cannot have children (such as
					// <br>), React will throw an exception if an array if
					// childen is supplied, even if the array is empty.
					return createElement(node.name!, nodeAttrs);
				} else {
					// Call the renderer recursively to render the children;
					// create a React element for the tag and its children.
					const children = node.children.map(renderNode);
					return createElement(node.name!, nodeAttrs, children);
				}
			}
		} else if (node.type === 'tag') {
			// Create a React element for the tag.
			return createElement(node.name!, node.attrs!);
		} else {
			// We don't render other types of nodes.
			return undefined;
		}
	};

	// Render all the nodes.
	const renderedNodes = parsedContent.map(renderNode);

	return <div>{renderedNodes}</div>;
};
