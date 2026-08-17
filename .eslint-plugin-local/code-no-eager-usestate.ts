/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/utils';

/**
 * Disallows call and `new` expressions as eager `useState` initializer
 * arguments. React evaluates an eager argument on every render and discards
 * the result after the first one, so the work repeats for nothing. This
 * amplified the configuration-read regression in posit-dev/positron#15427,
 * where components rendered per data grid cell each did several configuration
 * reads per frame. A lazy initializer (`useState(() => compute())`) runs
 * exactly once at mount and never changes rendered output relative to the
 * eager form.
 */
/**
 * Determines whether evaluating this expression during render executes a call
 * or `new` expression. Nested function and arrow bodies are skipped: a call
 * inside `useState({ onClick: () => foo() })` does not run during render.
 */
function containsEagerCall(node: TSESTree.Node): boolean {
	if (node.type === 'CallExpression' || node.type === 'NewExpression') {
		return true;
	}
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
		return false;
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent' || key === 'loc' || key === 'range') {
			continue;
		}
		if (Array.isArray(value)) {
			for (const child of value) {
				if (child && typeof child.type === 'string' && containsEagerCall(child)) {
					return true;
				}
			}
		} else if (value && typeof value.type === 'string' && containsEagerCall(value)) {
			return true;
		}
	}
	return false;
}

export default new class NoEagerUseState implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		type: 'suggestion',
		fixable: 'code',
		schema: [],
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			CallExpression: (node: TSESTree.CallExpression & eslint.Rule.NodeParentExtension) => {
				const callee = node.callee;
				const isUseState =
					(callee.type === 'Identifier' && callee.name === 'useState') ||
					(callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'useState');
				if (!isUseState || node.arguments.length === 0) {
					return;
				}

				const arg = node.arguments[0];
				if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
					return;
				}
				if (!containsEagerCall(arg)) {
					return;
				}

				context.report({
					node: arg as unknown as eslint.Rule.Node,
					message: 'React evaluates an eager useState argument on every render and discards the result after mount. Use a lazy initializer: useState(() => ...).',
					fix: fixer => fixer.insertTextBeforeRange(arg.range, '() => '),
				});
			},
		};
	}
};
