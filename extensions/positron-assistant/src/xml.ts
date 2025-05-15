/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

function xmlAttributes(attributes: Record<string, any>): string {
	return Object.entries(attributes)
		.map(([key, val]) => `${key}="${val}"`)
		.join(' ');
}

/**
 * Create an XML node.
 *
 * @param name The name of the node.
 * @param content The content of the node.
 * @param attributes The attributes of the node.
 * @returns The XML string representation of the node.
 */
export function node(name: string, content?: string, attributes?: Record<string, any>): string {
	let result = `<${name}`;
	if (attributes && Object.keys(attributes).length) {
		result += ` ${xmlAttributes(attributes)}`;
	}
	result += `>`;
	if (content && content.length > 0) {
		result += `\n${content}\n`;
	}
	result += `</${name}>`;
	return result;
}

/**
 * Create a self-closing XML node.
 *
 * @param name The name of the node.
 * @param attributes The attributes of the node.
 * @returns The XML string representation of the self-closing node.
 */
export function leaf(name: string, attributes?: Record<string, any>): string {
	let result = `<${name}`;
	if (attributes && Object.keys(attributes).length) {
		result += ` ${xmlAttributes(attributes)}`;
	}
	result += ` />`;
	return result;
}
