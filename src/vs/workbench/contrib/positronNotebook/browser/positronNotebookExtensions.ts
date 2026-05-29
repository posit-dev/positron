/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { BrandedService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PositronNotebookEditorWidget } from './PositronNotebookEditorWidget.js';

/**
 * This module is based on the editor extension system in src/vs/editor/browser/editorExtensions.ts
 */

/**
 * A Positron notebook contribution that gets created every time a new widget is
 * attached and gets disposed when the widget is disposed.
 */
export interface IPositronNotebookContribution {
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;
}

export interface IPositronNotebookContributionCtor<Services extends BrandedService[] = BrandedService[]> {
	new(widget: PositronNotebookEditorWidget, ...services: Services): IPositronNotebookContribution;
}

export interface IPositronNotebookContributionDescription {
	id: string;
	ctor: IPositronNotebookContributionCtor;
}

class PositronNotebookContributionRegistry {
	public static readonly INSTANCE = new PositronNotebookContributionRegistry();
	private readonly _contributions: IPositronNotebookContributionDescription[] = [];

	public registerContribution<Services extends BrandedService[]>(id: string, ctor: IPositronNotebookContributionCtor<Services>): void {
		this._contributions.push({ id, ctor: ctor as IPositronNotebookContributionCtor });
	}

	public getContributions(): IPositronNotebookContributionDescription[] {
		return this._contributions.slice(0);
	}
}

export function registerPositronNotebookContribution<Services extends BrandedService[]>(id: string, ctor: IPositronNotebookContributionCtor<Services>): void {
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
