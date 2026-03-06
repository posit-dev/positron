/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';

// Matches "codicon codicon-<name>" and captures <name>.
const CODICON_PATTERN = /\bcodicon\s+codicon-([\w-]+)/;

// Like CODICON_PATTERN but also matches when the icon name is absent (e.g. in a
// template quasi that ends with "codicon codicon-" before an interpolation).
const CODICON_PATTERN_PARTIAL = /\bcodicon\s+codicon-([\w-]+)?/;

export default new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'suggestion',
		hasSuggestions: true,
		messages: {
			noHardcodedCodicon:
				"Avoid using raw 'codicon codicon-*' CSS classes in JSX. " +
				'Use the <ThemeIcon> component instead (e.g. <ThemeIcon icon={Codicon.error} />). ' +
				'ThemeIcon provides a typed interface that catches typos at compile time, ' +
				'makes icon usage easy to find via code search, and simplifies future migration to themed icons.',
			replaceWithThemeIcon:
				'Replace with ThemeIcon component.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			'JSXAttribute[name.name="className"]': (node: any) => {
				const value = node.value;
				if (!value) {
					return;
				}

				// className='codicon codicon-foo'
				if (value.type === 'Literal' && typeof value.value === 'string') {
					const match = CODICON_PATTERN.exec(value.value);
					if (match) {
						reportWithSuggestion(context, node, match[1]);
					}
					return;
				}

				// className={'codicon codicon-foo'} or className={`... codicon codicon-foo ...`}
				if (value.type === 'JSXExpressionContainer') {
					const expr = value.expression;

					if (expr.type === 'Literal' && typeof expr.value === 'string') {
						const match = CODICON_PATTERN.exec(expr.value);
						if (match) {
							reportWithSuggestion(context, node, match[1]);
						}
					} else if (expr.type === 'TemplateLiteral') {
						// Use the partial pattern for quasis since the icon name may
						// be split across a quasi boundary (e.g. `codicon codicon-${x}`).
						const hasInterpolation = expr.expressions.length > 0;
						const pattern = hasInterpolation ? CODICON_PATTERN_PARTIAL : CODICON_PATTERN;
						for (const quasi of expr.quasis) {
							const match = pattern.exec(quasi.value.raw);
							if (match) {
								if (hasInterpolation) {
									// Can't auto-suggest when the icon name is dynamic.
									context.report({ node, messageId: 'noHardcodedCodicon' });
								} else {
									reportWithSuggestion(context, node, match[1]);
								}
								return; // one report per attribute is enough
							}
						}
					}
				}
			},
		};
	}
};

/**
 * Convert kebab-case codicon ID (e.g. "chevron-down") to the camelCase
 * property name on the Codicon object (e.g. "chevronDown").
 */
function kebabToCamel(s: string): string {
	return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Report with a suggest-style fix (lightbulb action, NOT auto-applied by --fix).
 *
 * Replaces the entire JSX element with:
 *   <ThemeIcon icon={Codicon.<prop>} className='<remaining classes>' />
 *
 * Import additions are NOT handled -- the developer adds them manually.
 */
function reportWithSuggestion(
	context: eslint.Rule.RuleContext,
	attrNode: any,
	iconId: string,
): void {
	const codiconProp = kebabToCamel(iconId);

	// Walk up: JSXAttribute -> JSXOpeningElement -> JSXElement
	const openingElement = attrNode.parent;
	const jsxElement = openingElement.parent;

	// Strip "codicon" and "codicon-<id>" from the class string, keep the rest.
	const classValue = extractClassString(attrNode);
	const remainingClasses = classValue
		? classValue
			.split(/\s+/)
			.filter((c: string) => c !== 'codicon' && c !== `codicon-${iconId}`)
			.join(' ')
			.trim()
		: '';

	const classNameAttr = remainingClasses
		? ` className='${remainingClasses}'`
		: '';
	const replacement = `<ThemeIcon icon={Codicon.${codiconProp}}${classNameAttr} />`;

	context.report({
		node: attrNode,
		messageId: 'noHardcodedCodicon',
		suggest: [
			{
				messageId: 'replaceWithThemeIcon',
				fix(fixer) {
					const target = jsxElement.type === 'JSXElement'
						? jsxElement
						: openingElement;
					return fixer.replaceText(target, replacement);
				},
			},
		],
	});
}

/** Extract the raw class string from a className JSXAttribute. */
function extractClassString(attrNode: any): string | null {
	const value = attrNode.value;
	if (value.type === 'Literal' && typeof value.value === 'string') {
		return value.value;
	}
	if (value.type === 'JSXExpressionContainer') {
		const expr = value.expression;
		if (expr.type === 'Literal' && typeof expr.value === 'string') {
			return expr.value;
		}
		if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
			return expr.quasis[0]?.value.raw ?? null;
		}
	}
	return null;
}
