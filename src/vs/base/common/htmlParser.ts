/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const attrRE = /\s([^'"/\s><]+?)[\s/>]|([^\s=]+)=\s?(".*?"|'.*?')/g;

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

function parseTag(tag: string, parent?: HtmlNode): HtmlNode {
	const res: HtmlNode = {
		type: 'tag',
		name: '',
		voidElement: false,
		attrs: {},
		children: [],
		parent
	};

	const tagMatch = tag.match(/<\/?([^\s]+?)[/\s>]/);
	if (tagMatch) {
		res.name = tagMatch[1];
		if (voidElements[tagMatch[1]] ||
			tag.charAt(tag.length - 2) === '/'
		) {
			res.voidElement = true;
		}

		// handle comment tag
		if (res.name.startsWith('!--')) {
			const endIndex = tag.indexOf('-->');
			return {
				type: 'comment',
				parent,
				comment: endIndex !== -1 ? tag.slice(4, endIndex) : '',
			};
		}
	}

	const reg = new RegExp(attrRE);
	let result = null;
	for (; ;) {
		result = reg.exec(tag);

		if (result === null) {
			break;
		}

		if (!result[0].trim()) {
			continue;
		}

		if (result[1]) {
			const attr = result[1].trim();
			let arr = [attr, ''];

			if (attr.indexOf('=') > -1) {
				arr = attr.split('=');
			}

			if (!res.attrs) {
				res.attrs = {};
			}
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

const tagRE = /<[a-zA-Z0-9\-\!\/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
const whitespaceRE = /^\s*$/;

export function parseHtml(html: string): Array<HtmlNode> {
	const result: Array<HtmlNode> = [];
	const arr: Array<HtmlNode> = [];
	let current: HtmlNode | undefined;
	let level = -1;

	// handle text at top level
	if (html.indexOf('<') !== 0) {
		const end = html.indexOf('<');
		result.push({
			type: 'text',
			content: end === -1 ? html : html.substring(0, end),
		});
	}

	html.replace(tagRE, (tag: string, index: number): string => {
		const isOpen = tag.charAt(1) !== '/';
		const isComment = tag.startsWith('<!--');
		const start = index + tag.length;
		const nextChar = html.charAt(start);

		if (isComment) {
			const comment = parseTag(tag, current!);

			// if we're at root, push new base node
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
			level++;

			current = parseTag(tag, current);
			if (!current.voidElement &&
				nextChar &&
				nextChar !== '<'
			) {
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
				level--;
				// move current up a level to match the end tag
				if (current.parent) {
					current = current.parent;
				}
			}
			if (nextChar !== '<' && nextChar) {
				// trailing text node
				// if we're at the root, push a base text node. otherwise add as
				// a child to the current node.
				if (level !== -1) {
					if (arr[level].children === undefined) {
						arr[level].children = [];
					}
				}
				const parent = level === -1 ? result : arr[level].children!;

				// calculate correct end of the content slice in case there's
				// no tag after the text node.
				const end = html.indexOf('<', start);
				let content = html.slice(start, end === -1 ? undefined : end);
				// if a node is nothing but whitespace, collapse it as the spec states:
				// https://www.w3.org/TR/html4/struct/text.html#h-9.1
				if (whitespaceRE.test(content)) {
					content = ' ';
				}
				// don't add whitespace-only text nodes if they would be trailing text nodes
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

	return result;
}
