/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from '../../../../base/common/strings.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../editor/common/languages/textToHtmlTokenizer.js';
import * as marked from '../../../../base/common/marked/marked.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

/**
 * Renders markdown with theme-aware syntax highlighting for Positron notebooks.
 * Unlike renderMarkdownDocument, this doesn't sanitize aggressively since notebook
 * content is trusted and needs to support local image paths.
 */
export async function renderNotebookMarkdown(
	content: string,
	extensionService: IExtensionService,
	languageService: ILanguageService
): Promise<string> {
	const m = new marked.Marked(
		markedHighlight({
			async: true,
			async highlight(code: string, lang: string): Promise<string> {
				if (!lang) {
					return escape(code);
				}

				await extensionService.whenInstalledExtensionsRegistered();

				const languageId = languageService.getLanguageIdByLanguageName(lang)
					?? languageService.getLanguageIdByLanguageName(lang.split(/\s+|:|,|(?!^)\{|\?]/, 1)[0]);

				return tokenizeToString(languageService, code, languageId);
			}
		})
	);

	return await m.parse(content, { async: true });
}

/**
 * Helper for marked.js syntax highlighting integration.
 *
 * NOTE: This code is duplicated from markdownDocumentRenderer.ts (MarkedHighlight namespace)
 * which itself copied it from https://github.com/markedjs/marked-highlight.
 *
 * We duplicate it here rather than modifying upstream code to avoid merge conflicts.
 * The MarkedHighlight namespace is private in upstream, so we can't import it.
 *
 * If VSCode upstream exports this utility in the future, we should use that instead.
 */
function markedHighlight(options: marked.MarkedOptions & {
	highlight: (code: string, lang: string) => string | Promise<string>;
	async?: boolean;
}): marked.MarkedExtension {
	if (!options || typeof options.highlight !== 'function') {
		throw new Error('Must provide highlight function');
	}

	return {
		async: !!options.async,
		walkTokens(token: marked.Token): Promise<void> | void {
			if (token.type !== 'code') {
				return;
			}

			if (options.async) {
				return Promise.resolve(options.highlight(token.text, token.lang || '')).then(updateToken(token));
			}

			const code = options.highlight(token.text, token.lang || '');
			if (code instanceof Promise) {
				throw new Error('markedHighlight is not set to async but the highlight function is async.');
			}
			updateToken(token)(code);
		},
		renderer: {
			code({ text, lang, escaped }: marked.Tokens.Code) {
				const classAttr = lang ? ` class="language-${escape(lang)}"` : '';
				text = text.replace(/\n$/, '');
				return `<pre><code${classAttr}>${escaped ? text : escape(text)}\n</code></pre>`;
			},
		},
	};
}

function updateToken(token: any) {
	return (code: string) => {
		if (typeof code === 'string' && code !== token.text) {
			token.escaped = true;
			token.text = code;
		}
	};
}
