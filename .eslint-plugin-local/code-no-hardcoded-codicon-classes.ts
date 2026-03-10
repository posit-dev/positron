/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ESLintUtils, TSESTree, AST_NODE_TYPES } from '@typescript-eslint/utils';

// Matches "codicon-" at a class-token boundary (start of string or after
// whitespace). Using (?:^|\s) instead of \b avoids false positives on
// hyphenated names like "btn-codicon-wrapper" where \b treats "-" as a
// word boundary.
const CODICON_PATTERN = /(?:^|\s)codicon-/;

/** Extract string content from a Literal or TemplateLiteral node. */
function getStrings(node: TSESTree.Node): string[] {
	if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
		return [node.value];
	}
	if (node.type === AST_NODE_TYPES.TemplateLiteral) {
		return node.quasis.map((q: TSESTree.TemplateElement) => q.value.raw);
	}
	return [];
}

function hasCodicon(node: TSESTree.Node): boolean {
	return getStrings(node).some(s => CODICON_PATTERN.test(s));
}

export default ESLintUtils.RuleCreator.withoutDocs({
	name: 'no-hardcoded-codicon-classes',
	meta: {
		type: 'suggestion',
		messages: {
			noHardcodedCodicon:
				'Avoid using raw \'codicon codicon-*\' CSS classes in JSX. ' +
				'Use the <ThemeIcon> component instead (e.g. <ThemeIcon icon={Codicon.error}/>). ' +
				'ThemeIcon provides a typed interface, makes icon usage easy to find, and simplifies ' +
				'future migration to themed icons.',
		},
		schema: [],
	},
	defaultOptions: [],
	create(context) {
		return {
			'JSXAttribute[name.name="className"]': (node: TSESTree.JSXAttribute) => {
				const { value } = node;
				if (!value) {
					return;
				}

				const report = () => context.report({ node, messageId: 'noHardcodedCodicon' });

				// className='codicon codicon-foo'
				if (hasCodicon(value)) {
					report();
					return;
				}

				if (value.type !== AST_NODE_TYPES.JSXExpressionContainer) {
					return;
				}
				const { expression } = value;
				if (expression.type === AST_NODE_TYPES.JSXEmptyExpression) {
					return;
				}

				// className={'codicon codicon-foo'} or className={`codicon codicon-${x}`}
				if (hasCodicon(expression)) {
					report();
					return;
				}

				// Don't specifically check for 'positronClassNames' to catch calls like
				// util.positronClassNames or importing as a different name.
				//
				// className={fn('codicon codicon-foo')}
				// className={fn('codicon', 'codicon-foo')}
				// className={fn(`codicon-${name}`)}
				if (expression.type === AST_NODE_TYPES.CallExpression) {
					for (const arg of expression.arguments) {
						if (hasCodicon(arg)) {
							report();
							return;
						}
					}
				}
			},
		};
	}
});
