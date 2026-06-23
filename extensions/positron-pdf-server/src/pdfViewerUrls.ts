/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The set of URLs the PDF viewer webview needs, derived from the server's base URL.
 */
export interface PdfViewerUrls {
	/** The server base URL, guaranteed to end with a trailing slash. */
	baseUrl: string;
	/** URL of the PDF document served by the PDF server. */
	pdfUrl: string;
	/** URL of the PDF.js viewer wrapper, carrying the PDF and theme as query params. */
	viewerUrl: string;
}

/**
 * Build the PDF and viewer URLs from the server's base URL.
 *
 * The base URL is normalized to end with a trailing slash so that Content
 * Security Policy source directives match every sub-path under it. Per CSP3
 * 6.7.2.7, a source with a non-empty path that lacks a trailing slash requires
 * an exact path match, which would otherwise reject the viewer/PDF sub-paths.
 *
 * @param serverUrl The server URL, with or without a trailing slash.
 * @param pdfId The id of the registered PDF document.
 * @param theme The PDF.js theme value (0 = auto, 1 = light, 2 = dark).
 */
export function buildPdfViewerUrls(serverUrl: string, pdfId: string, theme: number): PdfViewerUrls {
	const baseUrl = serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`;
	const pdfUrl = `${baseUrl}pdf/${pdfId}`;
	const viewerUrl = `${baseUrl}viewer?file=${encodeURIComponent(pdfUrl)}&theme=${theme}`;
	return { baseUrl, pdfUrl, viewerUrl };
}
