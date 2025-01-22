/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProxyServerHtml } from './types';

/**
 * PromiseHandles is a class that represents a promise that can be resolved or
 * rejected externally.
 */
export class PromiseHandles<T> {
	resolve!: (value: T | Promise<T>) => void;

	reject!: (error: unknown) => void;

	promise: Promise<T>;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

/**
 * A generic content rewriter for HTML content.
 * @param _serverOrigin The server origin.
 * @param proxyPath The proxy path.
 * @param _url The URL.
 * @param contentType The content type.
 * @param responseBuffer The response buffer.
 * @returns The rewritten response buffer.
 */
export async function htmlContentRewriter(
	_serverOrigin: string,
	proxyPath: string,
	_url: string,
	contentType: string,
	responseBuffer: Buffer,
	htmlConfig?: ProxyServerHtml
) {
	// If this isn't 'text/html' content, just return the response buffer.
	if (!contentType.includes('text/html')) {
		return responseBuffer;
	}

	// Get the response.
	let response = responseBuffer.toString('utf8');

	// If we're running in the web, we need to inject resources for the preview HTML.
	if (vscode.env.uiKind === vscode.UIKind.Web && htmlConfig) {
		response = injectPreviewResources(response, htmlConfig);
	}

	// Rewrite the URLs with the proxy path.
	response = rewriteUrlsWithProxyPath(response, proxyPath);

	// Return the response.
	return response;
}

/**
 * Injects the preview resources into the HTML content.
 * @param content The HTML content to inject the preview resources into.
 * @param htmlConfig The HTML configuration defining the preview resources.
 * @returns The content with the preview resources injected.
 */
export function injectPreviewResources(content: string, htmlConfig: ProxyServerHtml) {
	// If the response includes a head tag, inject the preview resources into the head tag.
	if (content.includes('<head>')) {
		// Inject the preview style defaults for unstyled preview documents.
		content = content.replace(
			'<head>',
			`<head>\n
			${htmlConfig.styleDefaults || ''}`
		);

		// Inject the preview style overrides and script.
		content = content.replace(
			'</head>',
			`${htmlConfig.styleOverrides || ''}
			${htmlConfig.script || ''}
			</head>`
		);
	} else {
		// Otherwise, prepend the HTML content with the preview resources.
		content = `${htmlConfig.styleDefaults || ''}
			${htmlConfig.styleOverrides || ''}
			${htmlConfig.script || ''}
			${content}`;
	}
	return content;
}

/**
 * A content rewriter for help content. Injects the help resources into the help HTML content.
 * @param _serverOrigin The server origin.
 * @param proxyPath The proxy path.
 * @param _url The URL.
 * @param contentType The content type.
 * @param responseBuffer The response buffer.
 * @param htmlConfig The HTML configuration.
 * @returns The rewritten response buffer.
 */
export async function helpContentRewriter(
	_serverOrigin: string,
	proxyPath: string,
	_url: string,
	contentType: string,
	responseBuffer: Buffer,
	htmlConfig?: ProxyServerHtml
) {
	// If this isn't 'text/html' content, just return the response buffer.
	if (!contentType.includes('text/html')) {
		return responseBuffer;
	}

	// Get the response.
	let response = responseBuffer.toString('utf8');

	if (htmlConfig) {
		// Build the help vars.
		let helpVars = '';

		// Destructure the HTML config.
		const {
			styleDefaults,
			styleOverrides,
			script: helpScript,
			styles: helpStyles
		} = htmlConfig;

		// Inject the help vars.
		if (helpStyles) {
			helpVars += '<style id="help-vars">\n';
			helpVars += '    body {\n';
			for (const style in helpStyles) {
				helpVars += `        --${style}: ${helpStyles[style]};\n`;
			}
			helpVars += '    }\n';
			helpVars += '</style>\n';
		}

		// Inject the help style defaults for unstyled help documents and the help vars.
		response = response.replace(
			'<head>',
			`<head>\n
			${helpVars}\n
			${styleDefaults}`
		);

		// Inject the help style overrides and the help script.
		response = response.replace(
			'</head>',
			`${styleOverrides}\n
			${helpScript}\n
			</head>`
		);
	}

	// Rewrite the URLs with the proxy path.
	response = rewriteUrlsWithProxyPath(response, proxyPath);

	// Return the response.
	return response;
}

/**
* Rewrites the URLs in the content.
* @param content The content.
* @param proxyPath The proxy path.
* @returns The content with the URLs rewritten.
*/
export function rewriteUrlsWithProxyPath(content: string, proxyPath: string): string {
	// When running on Web, we need to prepend root-relative URLs with the proxy path,
	// because the help proxy server is running at a different origin than the target origin.
	// When running on Desktop, we don't need to do this, because the help proxy server is
	// running at the same origin as the target origin (localhost).
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		// Prepend root-relative URLs with the proxy path. The proxy path may look like
		// /proxy/<PORT> or a different proxy path if an external uri is used.
		return content.replace(
			// This is icky and we should use a proper HTML parser, but it works for now.
			// Possible sources of error are: whitespace differences, single vs. double
			// quotes, etc., which are not covered in this regex.
			// Regex translation: look for src="/ or href="/ and replace it with
			// src="<PROXY_PATH> or href="<PROXY_PATH> respectively.
			/(src|href)="\/([^"]+)"/g,
			(match, p1, p2, _offset, _string, _groups) => {
				// Add a leading slash to the matched path which was removed by the regex.
				const matchedPath = '/' + p2;

				// If the URL already starts with the proxy path, don't rewrite it. Some app
				// frameworks may already have rewritten the URLs.
				// Example: match = src="/proxy/1234/path/to/resource"
				//             p2 = "proxy/1234/path/to/resource"
				if (matchedPath.startsWith(proxyPath)) {
					return match;
				}

				// Example: src="/path/to/resource" -> src="/proxy/1234/path/to/resource"
				return `${p1}="${proxyPath}/${p2}"`;
			}
		);
	}

	// Return the content as-is.
	return content;
}
