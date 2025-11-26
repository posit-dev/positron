/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { BrandedService } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

/**
 * This module is based on the editor extension system in src/vs/editor/browser/editorExtensions.ts
 */

/**
 * A Positron notebookcontribution that gets created every time a new notebook gets created
 * and gets disposed when the notebook gets disposed.
 */
export interface IPositronNotebookContribution {
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;
}

export interface IPositronNotebookContributionCtor {
	new(notebook: IPositronNotebookInstance, ...services: BrandedService[]): IPositronNotebookContribution;
}

export interface IPositronNotebookContributionDescription {
	id: string;
	ctor: IPositronNotebookContributionCtor;
}

class PositronNotebookContributionRegistry {
	public static readonly INSTANCE = new PositronNotebookContributionRegistry();
	private readonly _contributions: IPositronNotebookContributionDescription[] = [];

	public registerContribution(id: string, ctor: IPositronNotebookContributionCtor): void {
		this._contributions.push({ id, ctor: ctor as IPositronNotebookContributionCtor });
	}

	public getContributions(): IPositronNotebookContributionDescription[] {
		return this._contributions.slice(0);
	}
}

export function registerPositronNotebookContribution(id: string, ctor: IPositronNotebookContributionCtor): void {
	PositronNotebookContributionRegistry.INSTANCE.registerContribution(id, ctor);
}

export namespace PositronNotebookExtensionsRegistry {
	export function getNotebookContributions(): IPositronNotebookContributionDescription[] {
		return PositronNotebookContributionRegistry.INSTANCE.getContributions();
	}

	export function getSomeNotebookContributions(ids: string[]): IPositronNotebookContributionDescription[] {
		return PositronNotebookContributionRegistry.INSTANCE.getContributions().filter(c => ids.includes(c.id));
	}
}
