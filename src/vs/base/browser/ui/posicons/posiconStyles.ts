/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Posicon } from 'vs/base/common/posicons';
import 'vs/css!./posicon/posicon';
import 'vs/css!./posicon/posicon-modifiers';


export function formatRule(c: Posicon) {
	let def = c.definition;
	while (def instanceof Posicon) {
		def = def.definition;
	}
	return `.posicon-${c.id}:before { content: '${def.fontCharacter}'; }`;
}
