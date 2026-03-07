/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TSESTree } from '@typescript-eslint/utils';
import * as eslint from 'eslint';

// Matches any "codicon-" reference (with or without a name suffix).
const CODICON_PATTERN = /\bcodicon-/;

/** Extract string content from a Literal or TemplateLiteral node. */
function getStrings(node: TSESTree.Node): string[] {
	if (node.type === 'Literal' && typeof node.value === 'string') {
		return [node.value];
	}
	if (node.type === 'TemplateLiteral') {
		return node.quasis.map((q: TSESTree.TemplateElement) => q.value.raw);
	}
	return [];
}

function hasCodicon(node: TSESTree.Node): boolean {
	return getStrings(node).some(s => CODICON_PATTERN.test(s));
}

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

				// className='codicon codicon-foo'
				if (hasCodicon(value)) {
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

				// className={'codicon codicon-foo'} or className={`codicon codicon-${x}`}
				if (hasCodicon(expr)) {
					report();
					return;
				}

				// className={fn('codicon codicon-foo')}
				// className={fn('codicon', 'codicon-foo')}
				// className={fn(`codicon-${name}`)}
				if (expr.type === 'CallExpression') {
					for (const arg of expr.arguments) {
						if (hasCodicon(arg)) {
							report();
							return;
						}
					}
				}
			},
		};
	}
};
