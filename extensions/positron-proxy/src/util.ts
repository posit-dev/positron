/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
 * Remove the trailing slash from a URL if it exists.
 * @param url The URL.
 * @returns The URL without the trailing slash.
 */
export function removeTrailingSlash(url: string): string {
	return url.endsWith('/') ? url.slice(0, -1) : url;
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
export async function htmlContentRewriter(_serverOrigin: string, proxyPath: string, _url: string, contentType: string, responseBuffer: Buffer) {
	// If this isn't 'text/html' content, just return the response buffer.
	if (!contentType.includes('text/html')) {
		return responseBuffer;
	}

	// Get the response.
	let response = responseBuffer.toString('utf8');

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
