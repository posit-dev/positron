/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import yaml from 'js-yaml';

export interface PositronEventDefinitionParam {
	name: string;
	type: string;
	comment: string;
}

export interface PositronEventDefinition {
	name: string;
	comment: string;
	params: PositronEventDefinitionParam[];
}

const eventsYamlFile = `${__dirname}/../events.yaml`;
const eventsYamlContents = readFileSync(eventsYamlFile, { encoding: 'utf-8' });
export const events = yaml.load(eventsYamlContents) as PositronEventDefinition[];
