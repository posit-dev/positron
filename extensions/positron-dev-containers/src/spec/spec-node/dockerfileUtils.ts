/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import { Mount } from '../spec-configuration/containerFeaturesConfiguration';


const findFromLines = new RegExp(/^(?<line>\s*FROM.*)/, 'gmi');
const parseFromLine = /FROM\s+(?<platform>--platform=\S+\s+)?(?<image>"?[^\s]+"?)(\s+AS\s+(?<label>[^\s]+))?/i;

const fromStatement = /^\s*FROM\s+(?<platform>--platform=\S+\s+)?(?<image>"?[^\s]+"?)(\s+AS\s+(?<label>[^\s]+))?/mi;
const argEnvUserStatements = /^\s*(?<instruction>ARG|ENV|USER)\s+(?<name>[^\s=]+)([ =]+("(?<value1>\S+)"|(?<value2>\S+)))?/gmi;
const directives = /^\s*#\s*(?<name>\S+)\s*=\s*(?<value>.+)/;

const argumentExpression = /\$\{?(?<variable>[a-zA-Z0-9_]+)(?<isVarExp>:(?<option>-|\+)(?<word>[^\}]+))?\}?/g;

export interface Dockerfile {
	preamble: {
		version: string | undefined;
		directives: Record<string, string>;
		instructions: Instruction[];
	};
	stages: Stage[];
	stagesByLabel: Record<string, Stage>;
}

export interface Stage {
	from: From;
	instructions: Instruction[];
}

export interface From {
	platform?: string;
	image: string;
	label?: string;
}

export interface Instruction {
	instruction: string;
	name: string;
	value: string | undefined;
}

function parseFromStatement(line: string): From {
	const match = fromStatement.exec(line);
	if (!match) {
		return { image: 'unknown' };
	}
	let { platform, image, label } = match.groups as unknown as From;
	image = image.replace(/^['"]|['"]$/g, ''); // remove quotes
	return { platform, image, label };
}

export function extractDockerfile(dockerfile: string): Dockerfile {
	const fromStatementsAhead = /(?=^[\t ]*FROM)/gmi;
	const parts = dockerfile.split(fromStatementsAhead);
	const preambleStr = fromStatementsAhead.test(parts[0] || '') ? '' : parts.shift()!;
	const stageStrs = parts;
	const stages = stageStrs.map(stageStr => ({
		from: parseFromStatement(stageStr),
		instructions: extractInstructions(stageStr),
	}));
	const directives = extractDirectives(preambleStr);
	const versionMatch = directives.syntax && /^(?:docker.io\/)?docker\/dockerfile(?::(?<version>\S+))?/i.exec(directives.syntax) || undefined;
	const version = versionMatch && (versionMatch.groups?.version || 'latest');
	return {
		preamble: {
			version,
			directives,
			instructions: extractInstructions(preambleStr),
		},
		stages,
		stagesByLabel: stages.reduce((obj, stage) => {
			if (stage.from.label) {
				obj[stage.from.label] = stage;
			}
			return obj;
		}, {} as Record<string, Stage>),
	} as Dockerfile;
}

export function findUserStatement(dockerfile: Dockerfile, buildArgs: Record<string, string>, baseImageEnv: Record<string, string>, target: string | undefined) {
	let stage: Stage | undefined = target ? dockerfile.stagesByLabel[target] : dockerfile.stages[dockerfile.stages.length - 1];
	const seen = new Set<Stage>();
	while (stage) {
		if (seen.has(stage)) {
			return undefined;
		}
		seen.add(stage);

		const i = findLastIndex(stage.instructions, i => i.instruction === 'USER');
		if (i !== -1) {
			return replaceVariables(dockerfile, buildArgs, baseImageEnv, stage.instructions[i].name, stage, i) || undefined;
		}
		const image = replaceVariables(dockerfile, buildArgs, baseImageEnv, stage.from.image, dockerfile.preamble, dockerfile.preamble.instructions.length);
		stage = dockerfile.stagesByLabel[image];
	}
	return undefined;
}

export function findBaseImage(dockerfile: Dockerfile, buildArgs: Record<string, string>, target: string | undefined) {
	let stage: Stage | undefined = target ? dockerfile.stagesByLabel[target] : dockerfile.stages[dockerfile.stages.length - 1];
	const seen = new Set<Stage>();
	while (stage) {
		if (seen.has(stage)) {
			return undefined;
		}
		seen.add(stage);

		const image = replaceVariables(dockerfile, buildArgs, /* not available in FROM instruction */ {}, stage.from.image, dockerfile.preamble, dockerfile.preamble.instructions.length);
		const nextStage = dockerfile.stagesByLabel[image];
		if (!nextStage) {
			return image;
		}
		stage = nextStage;
	}
	return undefined;
}

function extractDirectives(preambleStr: string) {
	const map: Record<string, string> = {};
	for (const line of preambleStr.split(/\r?\n/)) {
		const groups = line.match(directives)?.groups;
		if (groups) {
			if (!map[groups.name]) {
				map[groups.name] = groups.value;
			}
		} else {
			break;
		}
	}
	return map;
}

function extractInstructions(stageStr: string) {
	return [...stageStr.matchAll(argEnvUserStatements)]
		.map(match => {
			const groups = match.groups!;
			return {
				instruction: groups.instruction.toUpperCase(),
				name: groups.name,
				value: groups.value1 || groups.value2,
			};
		});
}

function getExpressionValue(option: string, isSet: boolean, word: string, value: string) {
	const operations: Record<string, Function> = { 
		'-': (isSet: boolean, word: string, value: string) => isSet ? value : word,
		'+': (isSet: boolean, word: string, value: string) => isSet ? word : value,
	};

	return operations[option](isSet, word, value).replace(/^['"]|['"]$/g, ''); // remove quotes from start and end of the string
}

function replaceVariables(dockerfile: Dockerfile, buildArgs: Record<string, string>, baseImageEnv: Record<string, string>, str: string, stage: { from?: From; instructions: Instruction[] }, beforeInstructionIndex: number) {			
	return [...str.matchAll(argumentExpression)]
		.map(match => {
			const variable = match.groups!.variable;
			const isVarExp = match.groups!.isVarExp ? true : false;
			let value = findValue(dockerfile, buildArgs, baseImageEnv, variable, stage, beforeInstructionIndex) || '';
			if (isVarExp) {
				// Handle replacing variable expressions (${var:+word}) if they exist
				const option = match.groups!.option;
				const word = match.groups!.word;
				const isSet = value !== '';
				value = getExpressionValue(option, isSet, word, value);
			}

			return {
				begin: match.index!,
				end: match.index! + match[0].length,
				value,
			};
		}).reverse()
		.reduce((str, { begin, end, value }) => str.substring(0, begin) + value + str.substring(end), str);
}

function findValue(dockerfile: Dockerfile, buildArgs: Record<string, string>, baseImageEnv: Record<string, string>, variable: string, stage: { from?: From; instructions: Instruction[] }, beforeInstructionIndex: number): string | undefined {
	let considerArg = true;
	const seen = new Set<typeof stage>();
	while (true) {
		if (seen.has(stage)) {
			return undefined;
		}
		seen.add(stage);

		const i = findLastIndex(stage.instructions, i => i.name === variable && (i.instruction === 'ENV' || (considerArg && typeof (buildArgs[i.name] ?? i.value) === 'string')), beforeInstructionIndex - 1);
		if (i !== -1) {
			const instruction = stage.instructions[i];
			if (instruction.instruction === 'ENV') {
				return replaceVariables(dockerfile, buildArgs, baseImageEnv, instruction.value!, stage, i);
			}
			if (instruction.instruction === 'ARG') {
				return replaceVariables(dockerfile, buildArgs, baseImageEnv, buildArgs[instruction.name] ?? instruction.value, stage, i);
			}
		}

		if (!stage.from) {
			const value = baseImageEnv[variable];
			if (typeof value === 'string') {
				return value;
			}
			return undefined;
		}

		const image = replaceVariables(dockerfile, buildArgs, baseImageEnv, stage.from.image, dockerfile.preamble, dockerfile.preamble.instructions.length);
		stage = dockerfile.stagesByLabel[image] || dockerfile.preamble;
		beforeInstructionIndex = stage.instructions.length;
		considerArg = stage === dockerfile.preamble;
	}
}

function findLastIndex<T>(array: T[], predicate: (value: T, index: number, obj: T[]) => boolean, position = array.length - 1): number {
	for (let i = position; i >= 0; i--) {
		if (predicate(array[i], i, array)) {
			return i;
		}
	}
	return -1;
}

// not expected to be called externally (exposed for testing)
export function ensureDockerfileHasFinalStageName(dockerfile: string, defaultLastStageName: string): { lastStageName: string; modifiedDockerfile: string | undefined } {

	// Find the last line that starts with "FROM" (possibly preceeded by white-space)
	const fromLines = [...dockerfile.matchAll(findFromLines)];
	if (fromLines.length === 0) {
		throw new Error('Error parsing Dockerfile: Dockerfile contains no FROM instructions');
	}

	const lastFromLineMatch = fromLines[fromLines.length - 1];
	const lastFromLine = lastFromLineMatch.groups?.line as string;

	// Test for "FROM [--platform=someplat] base [as label]"
	// That is, match against optional platform and label
	const fromMatch = lastFromLine.match(parseFromLine);
	if (!fromMatch) {
		throw new Error('Error parsing Dockerfile: failed to parse final FROM line');
	}
	if (fromMatch.groups?.label) {
		return {
			lastStageName: fromMatch.groups.label,
			modifiedDockerfile: undefined,
		};
	}

	// Last stage doesn't have a name, so modify the Dockerfile to set the name to defaultLastStageName
	const lastLineStartIndex = (lastFromLineMatch.index as number) + (fromMatch.index as number);
	const lastLineEndIndex = lastLineStartIndex + lastFromLine.length;
	const matchedFromText = fromMatch[0];
	let modifiedDockerfile = dockerfile.slice(0, lastLineStartIndex + matchedFromText.length);

	modifiedDockerfile += ` AS ${defaultLastStageName}`;
	const remainingFromLineLength = lastFromLine.length - matchedFromText.length;
	modifiedDockerfile += dockerfile.slice(lastLineEndIndex - remainingFromLineLength);

	return { lastStageName: defaultLastStageName, modifiedDockerfile: modifiedDockerfile };
}

export function supportsBuildContexts(dockerfile: Dockerfile) {
	const version = dockerfile.preamble.version;
	if (!version) {
		return dockerfile.preamble.directives.syntax ? 'unknown' : false;
	}
	const numVersion = (/^\d+(\.\d+){0,2}/.exec(version) || [])[0];
	if (!numVersion) {
		return true; // latest, labs or no tag.
	}
	return semver.intersects(numVersion, '>=1.4');
}

/**
 * Convert mount command' arguments to string 
 * @param mount 
 * @returns mount command string 
 */
export function generateMountCommand(mount: Mount | string): string[] {
	const command: string = '--mount';

	if (typeof mount === 'string') {
		return [command, mount];
	}

	const type: string = `type=${mount.type},`;
	const source: string = mount.source ? `src=${mount.source},` : '';
	const destination: string = `dst=${mount.target}`;

	const args: string = `${type}${source}${destination}`;

	return [command, args];
}
