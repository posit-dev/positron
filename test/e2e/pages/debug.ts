/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect } from '@playwright/test';
import { Code } from '../infra/code';


const GLYPH_AREA = '.margin-view-overlays>:nth-child';
const BREAKPOINT_GLYPH = '.codicon-debug-breakpoint';
const STOP = `.debug-toolbar .action-label[aria-label*="Stop"]`;

const VIEWLET = 'div[id="workbench.view.debug"]';
const VARIABLE = `${VIEWLET} .debug-variables .monaco-list-row .expression`;

const STEP_OVER = `.debug-toolbar .action-label[aria-label*="Step Over"]`;
const STEP_INTO = `.debug-toolbar .action-label[aria-label*="Step Into"]`;
const CONTINUE = `.debug-toolbar .action-label[aria-label*="Continue"]`;
const STEP_OUT = `.debug-toolbar .action-label[aria-label*="Step Out"]`;

const STACK_FRAME = `${VIEWLET} .monaco-list-row .stack-frame`;

export interface IStackFrame {
	name: string;
	lineNumber: number;
}

/*
 *  Reuseable Positron debug functionality for tests to leverage
 */
export class Debug {

	constructor(private code: Code) {

	}

	async setBreakpointOnLine(lineNumber: number): Promise<void> {
		await test.step(`Debug: Set breakpoint on line ${lineNumber}`, async () => {
			await expect(this.code.driver.page.locator(`${GLYPH_AREA}(${lineNumber})`)).toBeVisible();
			await this.code.driver.page.locator(`${GLYPH_AREA}(${lineNumber})`).click({ position: { x: 5, y: 5 } });
			await expect(this.code.driver.page.locator(BREAKPOINT_GLYPH)).toBeVisible();
		});
	}

	async startDebugging(): Promise<void> {
		await test.step('Debug: Start', async () => {
			await this.code.driver.page.keyboard.press('F5');
			await expect(this.code.driver.page.locator(STOP)).toBeVisible();
		});
	}

	async getVariables(): Promise<string[]> {
		const variableLocators = await this.code.driver.page.locator(VARIABLE).all();

		const variables: string[] = [];
		for (const variable of variableLocators) {
			const text = await variable.textContent();
			if (text !== null) {
				variables.push(text);
			}
		}

		return variables;
	}

	async stepOver(): Promise<any> {
		await test.step('Debug: Step over', async () => {
			await this.code.driver.page.locator(STEP_OVER).click();
		});
	}

	async stepInto(): Promise<any> {
		await test.step('Debug: Step into', async () => {
			await this.code.driver.page.locator(STEP_INTO).click();
		});
	}

	async stepOut(): Promise<any> {
		await test.step('Debug: Step out', async () => {
			await this.code.driver.page.locator(STEP_OUT).click();
		});
	}

	async continue(): Promise<any> {
		await test.step('Debug: Continue', async () => {
			await this.code.driver.page.locator(CONTINUE).click();
		});
	}

	async getStack(): Promise<IStackFrame[]> {
		const stackLocators = await this.code.driver.page.locator(STACK_FRAME).all();

		const stack: IStackFrame[] = [];
		for (const stackLocator of stackLocators) {
			const name = await stackLocator.locator('.file-name').textContent();
			const lineNumberRaw = await stackLocator.locator('.line-number').textContent();
			const lineNumber = lineNumberRaw ? parseInt(lineNumberRaw.split(':').shift() || '0', 10) : 0;
			stack.push({ name: name || '', lineNumber: lineNumber });
		}

		return stack;
	}

	/**
	 * Verify: The debug pane is visible and contains the specified variable
	 *
	 * @param variableLabel The label of the variable to check in the debug pane
	 */
	async expectDebugPaneToContain(variableLabel: string): Promise<void> {
		await test.step(`Verify debug pane contains: ${variableLabel}`, async () => {
			await expect(this.code.driver.page.getByRole('button', { name: 'Debug Variables Section' })).toBeVisible();
			await expect(this.code.driver.page.getByLabel(variableLabel)).toBeVisible();
		});
	}

	/**
	 * Verify: The call stack is visible and contains the specified item
	 *
	 * @param item The item to check in the call stack
	 */
	async expectCallStackToContain(item: string): Promise<void> {
		await test.step(`Verify call stack contains: ${item}`, async () => {
			await expect(this.code.driver.page.getByRole('button', { name: 'Call Stack Section' })).toBeVisible();
			const debugCallStack = this.code.driver.page.locator('.debug-call-stack');
			await expect(debugCallStack.getByText(item)).toBeVisible();
		});
	}

	/**
	 * Verify: In browser mode at the specified frame
	 *
	 * @param number The frame number to check in the browser mode
	 */
	async expectBrowserModeFrame(number: number): Promise<void> {
		await test.step(`Verify in browser mode: frame ${number}`, async () => {
			await expect(this.code.driver.page.getByText(`Browse[${number}]>`)).toBeVisible();
		});
	}
}
