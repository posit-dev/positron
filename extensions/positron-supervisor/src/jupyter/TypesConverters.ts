/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as PositronTypes from './JupyterPositronTypes';

/**
 * The code location encodes line offsets (`character`) in Unicode points. This
 * choice of representation is originally for consistency with other location
 * types in the Jupyter protocol. However I now think this is a mistake because
 * doing anything other than UTF-8 offsets is inherently lossy if we don't have
 * access to the whole line (not a selected region like code locations) to
 * perform the conversion.
 *
 * The backend uses the `character` offset of the first line to insert
 * whitespace, so that the R parser creates source references with proper
 * offsets. If we send the offset in code points, the whitespace may be too
 * short. So we really need to send UTF-8 offsets to the backend.
 *
 * To perform non-lossy conversion of the offset, we need the full line of text.
 * The same applies to conversion to Unicode point and there's actually a bug in
 * our current code point conversion, since we don't look at the text before the
 * offset.
 *
 * We could retrieve the lines of text from the document at time of conversion
 * (here in `positron-supervisor`). This would allow us to correctly convert from
 * UTF-16 to UTF-8. However there's a race condition: the document might have
 * changed already.
 *
 * Alternatively, we could extend `execute()` with a way to send whole lines
 * with a selection range. Then we would have all the information to perform the
 * conversion.
 */

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
