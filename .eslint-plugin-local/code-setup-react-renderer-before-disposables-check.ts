/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ESLintUtils, TSESTree, AST_NODE_TYPES } from '@typescript-eslint/utils';

export default ESLintUtils.RuleCreator.withoutDocs({
	name: 'setup-react-renderer-before-disposables-check',
	meta: {
		type: 'problem',
		messages: {
			order: '`setupReactRenderer()` must be called before `ensureNoDisposablesAreLeakedInTestSuite()`. ' +
				'Mocha runs teardown hooks in FIFO order, so the React teardown must register first to unmount ' +
				'components and dispose VS Code disposables before the leak checker inspects them.',
		},
		schema: [],
	},
	defaultOptions: [],
	create(context) {
		return {
			// Match setupReactRenderer() as a direct statement (expression or variable declaration)
			// inside a suite callback.
			['CallExpression[callee.name="suite"] > :function > BlockStatement > ' +
				':matches(ExpressionStatement, VariableDeclaration) ' +
				'CallExpression[callee.name="setupReactRenderer"]']: (node: TSESTree.CallExpression) => {
					// Walk up to the BlockStatement to find sibling statements.
					let current: TSESTree.Node = node;
					while (current.parent) {
						if (current.parent.type === AST_NODE_TYPES.BlockStatement) {
							// Scan backward: if ensureNoDisposablesAreLeakedInTestSuite appears earlier, report it.
							const block = current.parent;
							const setupIdx = block.body.findIndex(s => s === current);
							for (let i = setupIdx - 1; i >= 0; i--) {
								if (isCallInStatement(block.body[i], 'ensureNoDisposablesAreLeakedInTestSuite')) {
									context.report({ node: block.body[i], messageId: 'order' });
									return;
								}
							}
						}
						current = current.parent;
					}
				},
		};
	}
});

/** Check whether a statement contains a call to the given function name. */
function isCallInStatement(node: TSESTree.Statement, name: string): boolean {
	if (node.type === AST_NODE_TYPES.ExpressionStatement) {
		return isCallTo(node.expression, name);
	}
	if (node.type === AST_NODE_TYPES.VariableDeclaration) {
		return node.declarations.some(d => d.init && isCallTo(d.init, name));
	}
	return false;
}

/** Checks whether an expression is a call to the given function name. */
function isCallTo(node: TSESTree.Expression, name: string): boolean {
	return node.type === AST_NODE_TYPES.CallExpression
		&& node.callee.type === AST_NODE_TYPES.Identifier
		&& node.callee.name === name;
}
