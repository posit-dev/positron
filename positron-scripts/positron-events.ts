/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

export interface PositronEventDefinitionParam {
	name: string;
	type: string;
	comment: string;
}

export interface PositronEventDefinition {
	name: string;
	params: PositronEventDefinitionParam[];
}

export const events = [
	<PositronEventDefinition>{
		name: 'BusyEvent',
		params: [
			<PositronEventDefinitionParam>{
				name: 'busy',
				type: 'boolean',
				comment: 'Whether the runtime is busy.'
			}
		]
	},
	<PositronEventDefinition>{
		'name': 'ShowMessageEvent',
		'params': [
			<PositronEventDefinitionParam>{
				'name': 'message',
				'type': 'string',
				'comment': 'The message to show to the user.'
			}
		]
	},
	<PositronEventDefinition>{
		'name': 'ShowHelpUrlEvent',
		'params': [
			<PositronEventDefinitionParam>{
				'name': 'url',
				'type': 'string',
				'comment': 'The URL to be shown in the Help pane.'
			}
		]
	}
];
