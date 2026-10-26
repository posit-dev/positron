/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Text to show as typed inside markdown, with every character markdown gives a meaning escaped.
 *
 * For names the user or their database chose -- a connection, a table, a column, a type -- which
 * may well hold an underscore, an asterisk or brackets. Markdown lets any ASCII punctuation be
 * escaped, so escaping one that means nothing where it lands costs nothing.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&');
}
