/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/*
 * This HTML parser is adapted with heavy modifications from the MIT-licensed
 * 'html-parse-stringify` library.
 * https://github.com/HenrikJoreteg/html-parse-stringify
 *
 * Modifications:
 * - Converted to TypeScript with type annotations and comments
 * - Tweaked variables to avoid type changes
 * - Added tracking of node parents to allow for easier traversal
 * - Remove support for component overrides
 */

// Regular expression matching HTML tag attributes
const attrRE = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?(".*?"|'.*?')/g;

/** Interface for a parsed HTML node. */
export interface HtmlNode {
	type: 'text' | 'component' | 'tag' | 'comment';
	parent?: HtmlNode;
	name?: string;
	comment?: string;
	content?: string;
	voidElement?: boolean;
	attrs?: Record<string, string>;
	children?: Array<HtmlNode>;
}

/**
 * Quick lookup table for 'void' elements. Void elements are those that don't
 * have children (are self-closing)
 */
const voidElements: Record<string, boolean> = {
	'area': true,
	'base': true,
	'br': true,
	'col': true,
	'embed': true,
	'hr': true,
	'img': true,
	'input': true,
	'link': true,
	'meta': true,
	'param': true,
	'source': true,
	'track': true,
	'wbr': true
};

/**
 * Parses a single HTML tag.
 *
 * @param tag The tag to parse
 * @param parent The tag's parent node
 * @returns A parsed HTML node
 */
function parseTag(tag: string, parent?: HtmlNode): HtmlNode {
	// This is our node result
	const res: HtmlNode = {
		type: 'tag',
		name: '',
		voidElement: false,
		attrs: {},
		children: [],
		parent
	};

	// Find the name of the tag
	const tagMatch = tag.match(/<\/?([^\s]+?)[/\s>]/);
	if (tagMatch) {
		// The tag has a name; save it
		res.name = tagMatch[1];
		if (voidElements[tagMatch[1]] ||
			tag.charAt(tag.length - 2) === '/'
		) {
			// This is a self-closing (void) element
			res.voidElement = true;
		}

		// Handle comment tag
		if (res.name.startsWith('!--')) {
			const endIndex = tag.indexOf('-->');
			return {
				type: 'comment',
				parent,
				comment: endIndex !== -1 ? tag.slice(4, endIndex) : '',
			};
		}
	}

	// Compile a new regular expression to parse the tag's attributes
	const reg = new RegExp(attrRE);
	let result = null;
	for (; ;) {
		// Find the next attribute
		result = reg.exec(tag);

		if (result === null) {
			// No more attributes
			break;
		}

		if (!result[0].trim()) {
			// Attribute without a name
			continue;
		}

		if (result[1]) {
			// Normal attribute
			const attr = result[1].trim();
			let arr = [attr, ''];

			if (attr.indexOf('=') > -1) {
				arr = attr.split('=');
			}

			// Create attribute object if needed
			if (!res.attrs) {
				res.attrs = {};
			}
			// Save this attribute
			res.attrs[arr[0]] = arr[1];
			reg.lastIndex--;
		} else if (result[2]) {
			if (!res.attrs) {
				res.attrs = {};
			}
			res.attrs[result[2]] = result[3].trim().substring(1, result[3].length - 1);
		}
	}

	return res;
}

// Regular expression matching HTML tags
const tagRE = /<[a-zA-Z0-9\-\!\/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
const whitespaceRE = /^\s*$/;

/**
 * Parses a string of HTML into an array of HTML nodes, using a simple
 * string-based HTML parsing engine.
 *
 * @param html The HTML to parse
 * @returns An array of the parsed HTML nodes
 */
export function parseHtml(html: string): Array<HtmlNode> {
	const result: Array<HtmlNode> = [];
	const arr: Array<HtmlNode> = [];
	let current: HtmlNode | undefined;
	let level = -1;

	// Handle text at top level
	if (html.indexOf('<') !== 0) {
		const end = html.indexOf('<');
		result.push({
			type: 'text',
			content: end === -1 ? html : html.substring(0, end),
		});
	}

	// Begin parsing the HTML
	html.replace(tagRE, (tag: string, index: number): string => {
		const isOpen = tag.charAt(1) !== '/';
		const isComment = tag.startsWith('<!--');
		const start = index + tag.length;
		const nextChar = html.charAt(start);

		if (isComment) {
			const comment = parseTag(tag, current);

			// If we're at root, push new base node
			if (level < 0) {
				result.push(comment);
				return '';
			}
			const parent = arr[level];
			if (parent.children === undefined) {
				parent.children = [];
			}
			parent.children.push(comment);
			return '';
		}

		if (isOpen) {
			// If this is an open tag, parse it and save as the current node,
			// then descend.
			level++;

			current = parseTag(tag, current);
			if (!current.voidElement &&
				nextChar &&
				nextChar !== '<'
			) {
				// This is a text node; add it as a child node
				if (current.children === undefined) {
					current.children = [];
				}
				current.children.push({
					type: 'text',
					content: html.slice(start, html.indexOf('<', start)),
				});
			}

			// if we're at root, push new base node
			if (level === 0) {
				result.push(current);
			}

			const parent = arr[level - 1];

			// Add this node to it parent's children array
			if (parent) {
				if (parent.children === undefined) {
					parent.children = [];
				}
				parent.children.push(current);
			}

			arr[level] = current;
		}

		if (current && (!isOpen || current.voidElement)) {
			if (level > -1 &&
				(current.voidElement || current.name === tag.slice(2, -1))
			) {
				// This is a close tag for the current node; move up the tree
				level--;
				if (current.parent) {
					current = current.parent;
				}
			}
			if (nextChar !== '<' && nextChar) {
				// This is a trailing text node.

				// If we're at the root, push a base text node. otherwise add as
				// a child to the current node.
				if (level !== -1) {
					if (arr[level].children === undefined) {
						arr[level].children = [];
					}
				}
				const parent = level === -1 ? result : arr[level].children!;

				// Calculate correct end of the content slice in case there's no
				// tag after the text node.
				const end = html.indexOf('<', start);
				let content = html.slice(start, end === -1 ? undefined : end);

				// If a node is nothing but whitespace, collapse it as the spec states:
				// https://www.w3.org/TR/html4/struct/text.html#h-9.1
				if (whitespaceRE.test(content)) {
					content = ' ';
				}

				// Don't add whitespace-only text nodes if they would be trailing text nodes
				// or if they would be leading whitespace-only text nodes:
				//  * end > -1 indicates this is not a trailing text node
				//  * leading node is when level is -1 and parent has length 0
				if ((end > -1 && level + parent.length >= 0) || content !== ' ') {
					parent.push({
						type: 'text',
						parent: current,
						content: content,
					});
				}
			}
		}

		return '';
	});

	// Return the parsed nodes.
	return result;
}
