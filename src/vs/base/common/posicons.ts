/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';

export interface IPosiconIconRegistry {
	readonly all: IterableIterator<Posicon>;
	readonly onDidRegister: Event<Posicon>;
	get(id: string): Posicon | undefined;
}

// Selects all posicon names encapsulated in the `$()` syntax and wraps the
// results with spaces so that screen readers can read the text better.
export function getPosiconAriaLabel(text: string | undefined) {
	if (!text) {
		return '';
	}

	return text.replace(/\$\((.*?)\)/g, (_match, posiconName) => ` ${posiconName} `).trim();
}

/**
 * The Posicon library is a set of default icons that are built-in in VS Code.
 *
 * In the product (outside of base) Posicons should only be used as defaults. In order to have all icons in VS Code
 * themeable, component should define new, UI component specific icons using `iconRegistry.registerIcon`.
 * In that call a Posicon can be named as default.
 */
export class Posicon implements PosiconCSSIcon {

	private constructor(public readonly id: string, public readonly definition: PosiconIconDefinition, public description?: string) {
		Posicon._allPosicons.push(this);
	}
	public get classNames() { return 'posicon posicon-' + this.id; }
	// classNamesArray is useful for migrating to ES6 classlist
	public get classNamesArray() { return ['posicon', 'posicon-' + this.id]; }
	public get cssSelector() { return '.posicon.posicon-' + this.id; }

	// registry
	private static _allPosicons: Posicon[] = [];

	/**
	 * @returns Returns all default icons covered by the posicon font. Only to be used by the icon registry in platform.
	 */
	public static getAll(): readonly Posicon[] {
		return Posicon._allPosicons;
	}

	// built-in icons, with image name
	public static readonly add = new Posicon('add', { fontCharacter: '\\ea60' });
	public static readonly circle = new Posicon('circle', { fontCharacter: '\\ea61' });
	public static readonly error = new Posicon('error', { fontCharacter: '\\ea62' });
}

export function getClassNamesArray(id: string, modifier?: string) {
	const classNames = ['posicon', 'posicon-' + id];
	if (modifier) {
		classNames.push('posicon-modifier-' + modifier);
	}
	return classNames;
}

export interface PosiconCSSIcon {
	readonly id: string;
}


export namespace PosiconCSSIcon {
	export const iconNameSegment = '[A-Za-z0-9]+';
	export const iconNameExpression = '[A-Za-z0-9-]+';
	export const iconModifierExpression = '~[A-Za-z]+';
	export const iconNameCharacter = '[A-Za-z0-9~-]';

	const cssIconIdRegex = new RegExp(`^(${iconNameExpression})(${iconModifierExpression})?$`);

	export function asClassNameArray(icon: PosiconCSSIcon): string[] {
		if (icon instanceof Posicon) {
			return ['posicon', 'posicon-' + icon.id];
		}
		const match = cssIconIdRegex.exec(icon.id);
		if (!match) {
			return asClassNameArray(Posicon.error);
		}
		const [, id, modifier] = match;
		const classNames = ['posicon', 'posicon-' + id];
		if (modifier) {
			classNames.push('posicon-modifier-' + modifier.substr(1));
		}
		return classNames;
	}

	export function asClassName(icon: PosiconCSSIcon): string {
		return asClassNameArray(icon).join(' ');
	}

	export function asCSSSelector(icon: PosiconCSSIcon): string {
		return '.' + asClassNameArray(icon).join('.');
	}
}


interface PosiconIconDefinition {
	fontCharacter: string;
}
