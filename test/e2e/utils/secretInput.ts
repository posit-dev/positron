/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';

/**
 * Sets an input's value with evaluate() instead of fill()/type()/pressSequentially(), whose
 * step titles carry the value ("Fill \"...\"") into blob and HTML reports.
 * Use for every secret: API keys, passwords, tokens.
 * Traces still record the evaluate argument and the field's DOM value, so a
 * run with traces on still holds the secret. CI keeps traces off.
 */
export async function fillSecretValue(locator: Locator, value: string): Promise<void> {
	await locator.evaluate((el: HTMLInputElement | HTMLTextAreaElement, val) => {
		// Take the value setter from the element's OWN realm (its document's window) rather than
		// the top-level window, so React's value tracker is bypassed even when the workbench
		// renders in a different browsing context (as it can on the web build).
		const view = el.ownerDocument.defaultView ?? window;
		const proto = el instanceof view.HTMLTextAreaElement
			? view.HTMLTextAreaElement.prototype
			: view.HTMLInputElement.prototype;
		const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
		if (nativeSetter) {
			nativeSetter.call(el, val);
		} else {
			el.value = val;
		}
		// React's onChange and Angular's default value accessor key off input; change is for
		// listeners that rely on it.
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, value);
}

/**
 * Asserts that an input holds `value` without putting the value in the expect step title or
 * in the failure message (toHaveValue would print it). Traces still record it, as with
 * fillSecretValue.
 */
export async function expectSecretValue(locator: Locator, value: string, timeout = 5000): Promise<void> {
	await expect.poll(
		() => locator.evaluate((el: HTMLInputElement | HTMLTextAreaElement, val) => el.value === val, value),
		{ message: 'secret field holds the expected value', timeout }
	).toBe(true);
}
