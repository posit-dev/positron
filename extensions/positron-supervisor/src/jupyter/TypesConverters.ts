/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as PositronTypes from './JupyterPositronTypes';

export namespace JupyterPositronLocation {
	export function from(location: vscode.Location, text: string): PositronTypes.JupyterPositronLocation {
		return {
			uri: location.uri.toString(),
			range: JupyterPositronRange.from(location.range, text),
		};
	}
}

export namespace JupyterPositronRange {
	export function from(range: vscode.Range, text: string): PositronTypes.JupyterPositronRange {
		return {
			start: JupyterPositronPosition.from(range.start, text),
			end: JupyterPositronPosition.from(range.end, text),
		};
	}
}

export namespace JupyterPositronPosition {
	export function from(position: vscode.Position, text: string): PositronTypes.JupyterPositronPosition {
		return {
			line: position.line,
			character: codePointOffsetFromUtf16Index(text, position.character),
		};
	}
}


export function codePointOffsetFromUtf16Index(text: string, utf16Index: number): number {
	if (utf16Index <= 0) {
		return 0;
	}

	let offset = 0;
	let i = 0;

	while (i < text.length && i < utf16Index) {
		const codePoint = text.codePointAt(i);
		if (codePoint === undefined) {
			break;
		}

		// Advance by 2 for surrogate pairs (code points > 0xFFFF), 1 otherwise
		i += codePoint > 0xFFFF ? 2 : 1;

		// Only count this code point if we haven't passed the target index
		if (i <= utf16Index) {
			++offset;
		}
	}

	return offset;
}
