/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The test reads the real HTML file from disk, so it needs Node's fs.
// eslint-disable-next-line local/code-import-patterns
import { readFileSync } from 'fs';

const WELCOME_HTML_PATH = `${import.meta.dirname}/../../browser/resources/welcome.html`;

// The body classes a webview sets for each theme kind. HC light also gets `vscode-high-contrast`.
const THEME_BODY_CLASSES = {
	'light': ['vscode-light'],
	'dark': ['vscode-dark'],
	'high contrast dark': ['vscode-high-contrast'],
	'high contrast light': ['vscode-high-contrast-light', 'vscode-high-contrast'],
};

describe('Help welcome page logo', () => {
	let logoRules: CSSStyleRule[];
	let logo: HTMLImageElement;

	beforeEach(() => {
		const html = readFileSync(WELCOME_HTML_PATH, 'utf8');

		const style = document.createElement('style');
		style.textContent = html.match(/<style[^>]*>(?<css>[\s\S]*?)<\/style>/)!.groups!.css;
		document.head.appendChild(style);
		logoRules = Array.from(style.sheet!.cssRules)
			.filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.cssText.includes('__logoSrc'));

		logo = document.createElement('img');
		logo.className = 'logo';
		document.body.appendChild(logo);

		return () => {
			style.remove();
			logo.remove();
			document.body.className = '';
		};
	});

	/** Returns the logo placeholders whose rules match under the given body classes. */
	function matchingLogos(bodyClasses: string[]): string[] {
		document.body.className = bodyClasses.join(' ');
		return logoRules
			.filter(rule => logo.matches(rule.selectorText))
			.map(rule => rule.cssText.match(/__logoSrc(?<kind>\w+)__/)!.groups!.kind);
	}

	it('uses exactly one logo for each theme kind', () => {
		const logos = Object.fromEntries(
			Object.entries(THEME_BODY_CLASSES).map(([theme, bodyClasses]) => [theme, matchingLogos(bodyClasses)])
		);
		expect(logos).toEqual({
			'light': ['Light'],
			'dark': ['Dark'],
			'high contrast dark': ['Dark'],
			'high contrast light': ['Light'],
		});
	});
});
