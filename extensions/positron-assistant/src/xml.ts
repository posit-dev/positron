/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: The goal of this module is to use XML-like syntax to structure information
 *       in LLM conversations, NOT to create valid XML. We may drift significantly
 *       from XML syntax if it produces better LLM results. This is also why we decided
 *       to not use a third party library.
 */

function xmlAttributes(attributes: Record<string, any>): string {
	return Object.entries(attributes)
		.map(([key, val]) => `${key}="${val}"`)
		.join(' ');
}

/**
 * Create an XML-like node for structuring information in LLM prompts.
 *
 * NOTE: Do not use this function where valid XML is required.
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
 * Create a self-closing XML node for structuring information in LLM prompts.
 *
 * NOTE: Do not use this function where valid XML is required.
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
