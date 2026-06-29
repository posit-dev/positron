/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AskAssistantAction } from '../../browser/AskAssistantAction.js';

/**
 * The Ask Assistant action is gated on the AI main switch (`config.ai.enabled`).
 * The menu `when` clause hides the editor toolbar button, but the action also
 * sets `f1: true`, so it gets a command palette entry whose visibility is driven
 * by the action's `precondition`. Without a precondition the command stayed in
 * the palette (and runnable) even with AI disabled, so assert both gates.
 */
describe('AskAssistantAction', () => {
	const desc = new AskAssistantAction().desc;

	it('gates the command palette entry and execution via precondition', () => {
		expect(desc.precondition?.serialize()).toBe('config.ai.enabled');
	});

	it('gates the editor toolbar button via the menu when clause', () => {
		const menu = Array.isArray(desc.menu) ? desc.menu[0] : desc.menu;
		expect(menu?.when?.serialize()).toContain('config.ai.enabled');
	});
});
