/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TSESTree } from '@typescript-eslint/utils';
import * as eslint from 'eslint';

// Matches "codicon codicon-<name>" in a full string.
const CODICON_PAIR = /\bcodicon\s+codicon-[\w-]+/;

// Matches when the icon name is absent (e.g. in a template quasi that
// ends with "codicon codicon-" before an interpolation).
const CODICON_PAIR_PARTIAL = /\bcodicon\s+codicon-/;

// Matches an individual "codicon-<name>" class for split-argument detection
// in call expressions like positronClassNames('codicon', 'codicon-error').
// The [\w-]* (zero or more) with $ also catches `codicon-${name}` templates.
const CODICON_INDIVIDUAL = /\bcodicon-[\w-]*$/;

/**
 * Test whether a Literal or TemplateLiteral node contains text matching
 * `pattern`. For TemplateLiterals with interpolations, `partialPattern` is
 * used instead (if provided) since the value is split across quasis.
 */
function matchesText(node: TSESTree.Node, pattern: RegExp, partialPattern?: RegExp): boolean {
	if (node.type === 'Literal' && typeof node.value === 'string') {
		return pattern.test(node.value);
	}
	if (node.type === 'TemplateLiteral') {
		const p = (node.expressions.length > 0 && partialPattern) || pattern;
		return node.quasis.some((q: TSESTree.TemplateElement) => p.test(q.value.raw));
	}
	return false;
}

const hasPair = (node: TSESTree.Node) => matchesText(node, CODICON_PAIR, CODICON_PAIR_PARTIAL);

export default new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'suggestion',
		messages: {
			noHardcodedCodicon:
				'Avoid using raw \'codicon codicon-*\' CSS classes in JSX. ' +
				'Use the <ThemeIcon> component instead (e.g. <ThemeIcon icon={Codicon.error}/>). ' +
				'ThemeIcon provides a typed interface, makes icon usage easy to find, and simplifies ' +
				'future migration to themed icons.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			'JSXAttribute[name.name="className"]': (ruleNode: eslint.Rule.Node) => {
				const node = ruleNode as unknown as TSESTree.JSXAttribute;
				const value = node.value;
				if (!value) {
					return;
				}

				const report = () => context.report({ node: ruleNode, messageId: 'noHardcodedCodicon' });

				// className='codicon codicon-foo' or className={`codicon codicon-${x}`}
				if (hasPair(value)) {
					report();
					return;
				}

				if (value.type !== 'JSXExpressionContainer') {
					return;
				}
				const expr = value.expression;
				if (expr.type === 'JSXEmptyExpression') {
					return;
				}

				// className={'codicon codicon-foo'} or className={`codicon codicon-foo`}
				if (hasPair(expr)) {
					report();
					return;
				}

				// className={fn('codicon codicon-foo')}
				// className={fn('codicon', 'codicon-foo')}
				// className={fn(`codicon-${name}`)}
				if (expr.type === 'CallExpression') {
					for (const arg of expr.arguments) {
						if (hasPair(arg) || matchesText(arg, CODICON_INDIVIDUAL)) {
							report();
							return;
						}
					}
				}
			},
		};
	}
};
