/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IElement {
	readonly tagName: string;
	readonly className: string;
	readonly textContent: string;
	readonly attributes: { [name: string]: string };
	readonly children: IElement[];
	readonly top: number;
	readonly left: number;
}

export interface ILocaleInfo {
	readonly language: string;
	readonly locale?: string;
}

export interface ILocalizedStrings {
	readonly open: string;
	readonly close: string;
	readonly find: string;
}

export interface ILogFile {
	readonly relativePath: string;
	readonly contents: string;
}

export interface IWindowDriver {
	setValue(selector: string, text: string): Promise<void>;
	isActiveElement(selector: string): Promise<boolean>;
	getElements(selector: string, recursive: boolean): Promise<IElement[]>;
	getElementXY(selector: string, xoffset?: number, yoffset?: number): Promise<{ x: number; y: number }>;
	typeInEditor(selector: string, text: string): Promise<void>;
	getTerminalBuffer(selector: string): Promise<string[]>;
	writeInTerminal(selector: string, text: string): Promise<void>;
	getLocaleInfo(): Promise<ILocaleInfo>;
	getLocalizedStrings(): Promise<ILocalizedStrings>;
	getLogs(): Promise<ILogFile[]>;
	whenWorkbenchRestored(): Promise<void>;
	exitApplication(): Promise<void>;
}
