/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

/**
 * The overlay shown on an editor whose file has edits made by an agent that
 * the user has not yet kept or undone.
 */
export class EditReview {

	private readonly overlay: Locator;

	constructor(code: Code) {
		this.overlay = code.driver.currentPage.locator('.chat-editor-overlay-widget');
	}

	async expectPendingEdits(timeout = 30000): Promise<void> {
		await expect(this.overlay).toBeVisible({ timeout });
	}

	async expectNoPendingEdits(): Promise<void> {
		await expect(this.overlay).toBeHidden();
	}

	/** Keep the pending edits in the active file. */
	async keep(): Promise<void> {
		await this.overlay.locator('.action-label', { hasText: 'Keep' }).click();
	}

	/** Undo the pending edits in the active file. */
	async undo(): Promise<void> {
		await this.overlay.locator('.action-label', { hasText: 'Undo' }).click();
	}
}
