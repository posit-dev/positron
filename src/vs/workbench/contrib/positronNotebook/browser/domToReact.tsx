/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

/**
 * Component override map - allows replacing specific HTML tags with React components.
 */
export interface ComponentOverrides {
	[tagName: string]: React.ComponentType<any>;
}

/**
 * Counter for generating unique keys across the entire conversion process.
 */
let keyCounter = 0;

/**
 * Converts a container's children to an array of React elements.
 * This is the main entry point for converting DOM from safeSetInnerHtml.
 *
 * @param container The container element (typically a div with rendered HTML inside)
 * @param componentOverrides Map of tag names to React components
 * @returns Array of React elements
 */
export function convertDomChildrenToReact(
	container: HTMLElement,
	componentOverrides: ComponentOverrides = {}
): React.ReactElement[] {
	// Reset key counter for each conversion
	keyCounter = 0;

	const elements: React.ReactElement[] = [];

	for (let i = 0; i < container.childNodes.length; i++) {
		const child = container.childNodes[i];
		const converted = convertDomToReactWithCounter(child, componentOverrides);
		if (converted !== null) {
			// Wrap strings in a span to ensure we return React elements
			if (typeof converted === 'string') {
				elements.push(React.createElement('span', { key: `text-${keyCounter++}` }, converted));
			} else {
				elements.push(converted);
			}
		}
	}

	return elements;
}

/**
 * Internal version of convertDomToReact that uses a global counter for unique keys.
 */
function convertDomToReactWithCounter(
	node: Node,
	componentOverrides: ComponentOverrides = {}
): React.ReactElement | string | null {
	// Handle text nodes
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent || '';
	}

	// Handle comment nodes - skip them
	if (node.nodeType === Node.COMMENT_NODE) {
		return null;
	}

	// Handle element nodes
	if (node.nodeType === Node.ELEMENT_NODE) {
		const element = node as Element;
		const tagName = element.tagName.toLowerCase();

		// Convert HTML attributes to React props
		const props = convertAttributesToProps(element);

		// Convert child nodes recursively
		const children: (React.ReactElement | string)[] = [];
		for (let i = 0; i < element.childNodes.length; i++) {
			const childNode = element.childNodes[i];
			const converted = convertDomToReactWithCounter(childNode, componentOverrides);
			if (converted !== null) {
				children.push(converted);
			}
		}

		// Add key prop for React list rendering
		const key = `${tagName}-${keyCounter++}`;
		const propsWithKey = { ...props, key };

		// Check if there's a component override for this tag
		if (componentOverrides[tagName]) {
			const Component = componentOverrides[tagName];
			// Pass children as array if present, otherwise pass nothing
			if (children.length > 0) {
				return React.createElement(Component, propsWithKey, ...children);
			} else {
				return React.createElement(Component, propsWithKey);
			}
		}

		// Create standard React element
		if (children.length > 0) {
			return React.createElement(tagName, propsWithKey, ...children);
		} else {
			return React.createElement(tagName, propsWithKey);
		}
	}

	// Unknown node type - skip it
	return null;
}

/**
 * Converts HTML element attributes to React props object.
 * Handles special cases like class -> className, style parsing, etc.
 *
 * @param element The HTML element
 * @returns Object with React props
 */
function convertAttributesToProps(element: Element): Record<string, any> {
	const props: Record<string, any> = {};

	// Convert all attributes
	for (let i = 0; i < element.attributes.length; i++) {
		const attr = element.attributes[i];
		let propName = attr.name;
		let propValue: any = attr.value;

		// Handle special React prop names
		if (propName === 'class') {
			propName = 'className';
		} else if (propName === 'for') {
			propName = 'htmlFor';
		} else if (propName === 'style') {
			// Parse inline style string into object
			propValue = parseStyleString(attr.value);
		} else if (propName.startsWith('data-') || propName.startsWith('aria-')) {
			// Keep data- and aria- attributes as-is
			propName = propName;
		} else if (propName.includes('-')) {
			// Convert kebab-case to camelCase for other attributes
			propName = kebabToCamelCase(propName);
		}

		props[propName] = propValue;
	}

	return props;
}

/**
 * Parses an inline style string into a React style object.
 *
 * @param styleString The inline style string (e.g., "color: red; font-size: 14px")
 * @returns React style object
 */
function parseStyleString(styleString: string): Record<string, string> {
	const style: Record<string, string> = {};

	if (!styleString || styleString.trim() === '') {
		return style;
	}

	// Split by semicolon and parse each property
	const declarations = styleString.split(';');
	for (const declaration of declarations) {
		const colonIndex = declaration.indexOf(':');
		if (colonIndex === -1) {
			continue;
		}

		const property = declaration.substring(0, colonIndex).trim();
		const value = declaration.substring(colonIndex + 1).trim();

		if (property && value) {
			// Convert CSS property names to camelCase (e.g., font-size -> fontSize)
			const camelProperty = kebabToCamelCase(property);
			style[camelProperty] = value;
		}
	}

	return style;
}

/**
 * Converts kebab-case strings to camelCase.
 *
 * @param str The kebab-case string
 * @returns The camelCase version
 */
function kebabToCamelCase(str: string): string {
	return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
