/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HtmlNode, parseHtml } from 'vs/base/common/htmlParser';
import * as React from 'react';


/**
 * Renders HTML to React elements.
 *
 * @param html A string of untrusted HTML.
 * @returns A React element containing the rendered HTML.
 */
export const renderHtml = (html: string): React.ReactElement => {

	// Parse the HTML into a tree of nodes. This is a very simple-minded parser
	// that finds HTML tags and attributes using regular expressions.
	//
	// Because this code must run in a very strict security context, we cannot
	// use parsers that rely on `innerHTML` or `DOMParser`.
	const parsedContent = parseHtml(html);

	// Render the nodes into React elements.
	const renderNode = (node: HtmlNode): React.ReactElement | undefined => {
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
				return React.createElement(node.name!, node.attrs, node.children[0].content);
			} else {
				if (node.children.length === 0) {
					// If the node has no children, create a React element for
					// the tag. For tags that cannot have children (such as
					// <br>), React will throw an exception if an array if
					// childen is supplied, even if the array is empty.
					return React.createElement(node.name!, node.attrs);
				} else {
					// Call the renderer recursively to render the children;
					// create a React element for the tag and its children.
					const children = node.children.map(renderNode);
					return React.createElement(node.name!, node.attrs, children);
				}
			}
		} else if (node.type === 'tag') {
			// Create a React element for the tag.
			return React.createElement(node.name!, node.attrs);
		} else {
			// We don't render other types of nodes.
			return undefined;
		}
	};

	// Render all the nodes.
	const renderedNodes = parsedContent.map(renderNode);

	return <div>{renderedNodes}</div>;
};
