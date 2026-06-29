/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ContextKeyExpression, IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../common/positronNotebookCommon.js';
import { AskAssistantAction } from '../../browser/AskAssistantAction.js';

/**
 * The Ask Assistant action is gated on both AI switches: the global
 * `config.ai.enabled` and the notebooks-only `config.notebook.ai.enabled`,
 * combined with AND. The menu `when` clause hides the editor toolbar button,
 * but the action also sets `f1: true`, so it gets a command palette entry whose
 * visibility is driven by the action's `precondition`. Without a precondition
 * the command stayed in the palette (and runnable) even with AI disabled.
 *
 * These tests evaluate the real expressions against contexts rather than
 * string-matching the serialized form, so an inverted (`not`) or OR-ed gate
 * (which would still contain the key substring) is caught.
 */
describe('AskAssistantAction', () => {
	const desc = new AskAssistantAction().desc;

	// Minimal IContext backed by a plain map of context-key -> value.
	function evaluate(expr: ContextKeyExpression | undefined, values: Record<string, unknown>): boolean {
		expect(expr).toBeDefined();
		const context: IContext = {
			getValue: (key: string) => values[key] as never,
		};
		return expr!.evaluate(context);
	}

	describe('precondition (command palette entry + execution)', () => {
		it('is enabled only when both AI switches are on', () => {
			expect(evaluate(desc.precondition, { 'config.ai.enabled': true, 'config.notebook.ai.enabled': true })).toBe(true);
		});

		it('is disabled when ai.enabled is off (notebook.ai.enabled on)', () => {
			expect(evaluate(desc.precondition, { 'config.ai.enabled': false, 'config.notebook.ai.enabled': true })).toBe(false);
		});

		it('is disabled when notebook.ai.enabled is off (ai.enabled on)', () => {
			expect(evaluate(desc.precondition, { 'config.ai.enabled': true, 'config.notebook.ai.enabled': false })).toBe(false);
		});
	});

	describe('menu when clause (editor toolbar button)', () => {
		const menu = Array.isArray(desc.menu) ? desc.menu[0] : desc.menu;
		const activeNotebook = { 'activeEditor': POSITRON_NOTEBOOK_EDITOR_ID };

		it('is shown only when both AI switches are on in the notebook editor', () => {
			expect(evaluate(menu?.when, { ...activeNotebook, 'config.ai.enabled': true, 'config.notebook.ai.enabled': true })).toBe(true);
		});

		it('is hidden when ai.enabled is off', () => {
			expect(evaluate(menu?.when, { ...activeNotebook, 'config.ai.enabled': false, 'config.notebook.ai.enabled': true })).toBe(false);
		});

		it('is hidden when notebook.ai.enabled is off', () => {
			expect(evaluate(menu?.when, { ...activeNotebook, 'config.ai.enabled': true, 'config.notebook.ai.enabled': false })).toBe(false);
		});
	});
});
