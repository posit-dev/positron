/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';

// Matches "codicon codicon-<name>" in a full string.
const CODICON_PATTERN = /\bcodicon\s+codicon-[\w-]+/;

// Also matches when the icon name is absent (e.g. in a template quasi that
// ends with "codicon codicon-" before an interpolation).
const CODICON_PATTERN_PARTIAL = /\bcodicon\s+codicon-/;

export default new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'suggestion',
		messages: {
			noHardcodedCodicon:
				'Avoid using raw \'codicon codicon-*\' CSS classes in JSX. ' +
				'Use the <ThemeIcon> component instead (e.g. <ThemeIcon icon={Codicon.error} />). ' +
				'ThemeIcon provides a typed interface that catches typos at compile time, ' +
				'makes icon usage easy to find via code search, and simplifies future migration to themed icons.',
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
					if (CODICON_PATTERN.test(value.value)) {
						context.report({ node, messageId: 'noHardcodedCodicon' });
					}
					return;
				}

				// className={'codicon codicon-foo'} or className={`... codicon codicon-foo ...`}
				if (value.type === 'JSXExpressionContainer') {
					const expr = value.expression;

					if (expr.type === 'Literal' && typeof expr.value === 'string') {
						if (CODICON_PATTERN.test(expr.value)) {
							context.report({ node, messageId: 'noHardcodedCodicon' });
						}
					} else if (expr.type === 'TemplateLiteral') {
						const hasInterpolation = expr.expressions.length > 0;
						const pattern = hasInterpolation ? CODICON_PATTERN_PARTIAL : CODICON_PATTERN;
						for (const quasi of expr.quasis) {
							if (pattern.test(quasi.value.raw)) {
								context.report({ node, messageId: 'noHardcodedCodicon' });
								return; // one report per attribute is enough
							}
						}
					}
				}
			},
		};
	}
};
