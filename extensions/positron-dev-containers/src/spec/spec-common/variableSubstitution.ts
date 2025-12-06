/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as crypto from 'crypto';

import { ContainerError } from './errors';
import { URI } from 'vscode-uri';

export interface SubstitutionContext {
	platform: NodeJS.Platform;
	configFile?: URI;
	localWorkspaceFolder?: string;
	containerWorkspaceFolder?: string;
	env: NodeJS.ProcessEnv;
}

export function substitute<T extends object>(context: SubstitutionContext, value: T): T {
	let env: NodeJS.ProcessEnv | undefined;
	const isWindows = context.platform === 'win32';
	const updatedContext = {
		...context,
		get env() {
			return env || (env = normalizeEnv(isWindows, context.env));
		}
	};
	const replace = replaceWithContext.bind(undefined, isWindows, updatedContext);
	if (context.containerWorkspaceFolder) {
		updatedContext.containerWorkspaceFolder = resolveString(replace, context.containerWorkspaceFolder);
	}
	return substitute0(replace, value);
}

export function beforeContainerSubstitute<T extends object>(idLabels: Record<string, string> | undefined, value: T): T {
	let devcontainerId: string | undefined;
	return substitute0(replaceDevContainerId.bind(undefined, () => devcontainerId || (idLabels && (devcontainerId = devcontainerIdForLabels(idLabels)))), value);
}

export function containerSubstitute<T extends object>(platform: NodeJS.Platform, configFile: URI | undefined, containerEnv: NodeJS.ProcessEnv, value: T): T {
	const isWindows = platform === 'win32';
	return substitute0(replaceContainerEnv.bind(undefined, isWindows, configFile, normalizeEnv(isWindows, containerEnv)), value);
}

type Replace = (match: string, variable: string, args: string[]) => string;

function substitute0(replace: Replace, value: any): any {
	if (typeof value === 'string') {
		return resolveString(replace, value);
	} else if (Array.isArray(value)) {
		return value.map(s => substitute0(replace, s));
	} else if (value && typeof value === 'object' && !URI.isUri(value)) {
		const result: any = Object.create(null);
		Object.keys(value).forEach(key => {
			result[key] = substitute0(replace, value[key]);
		});
		return result;
	}
	return value;
}

const VARIABLE_REGEXP = /\$\{(.*?)\}/g;

function normalizeEnv(isWindows: boolean, originalEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	if (isWindows) {
		const env = Object.create(null);
		Object.keys(originalEnv).forEach(key => {
			env[key.toLowerCase()] = originalEnv[key];
		});
		return env;
	}
	return originalEnv;
}

function resolveString(replace: Replace, value: string): string {
	// loop through all variables occurrences in 'value'
	return value.replace(VARIABLE_REGEXP, evaluateSingleVariable.bind(undefined, replace));
}

function evaluateSingleVariable(replace: Replace, match: string, variable: string): string {

	// try to separate variable arguments from variable name
	let args: string[] = [];
	const parts = variable.split(':');
	if (parts.length > 1) {
		variable = parts[0];
		args = parts.slice(1);
	}

	return replace(match, variable, args);
}

function replaceWithContext(isWindows: boolean, context: SubstitutionContext, match: string, variable: string, args: string[]) {
	switch (variable) {
		case 'env':
		case 'localEnv':
			return lookupValue(isWindows, context.env, args, match, context.configFile);

		case 'localWorkspaceFolder':
			return context.localWorkspaceFolder !== undefined ? context.localWorkspaceFolder : match;

		case 'localWorkspaceFolderBasename':
			return context.localWorkspaceFolder !== undefined ? (isWindows ? path.win32 : path.posix).basename(context.localWorkspaceFolder) : match;

		case 'containerWorkspaceFolder':
			return context.containerWorkspaceFolder !== undefined ? context.containerWorkspaceFolder : match;

		case 'containerWorkspaceFolderBasename':
			return context.containerWorkspaceFolder !== undefined ? path.posix.basename(context.containerWorkspaceFolder) : match;

		default:
			return match;
	}
}

function replaceContainerEnv(isWindows: boolean, configFile: URI | undefined, containerEnvObj: NodeJS.ProcessEnv, match: string, variable: string, args: string[]) {
	switch (variable) {
		case 'containerEnv':
			return lookupValue(isWindows, containerEnvObj, args, match, configFile);

		default:
			return match;
	}
}

function replaceDevContainerId(getDevContainerId: () => string | undefined, match: string, variable: string) {
	switch (variable) {
		case 'devcontainerId':
			return getDevContainerId() || match;

		default:
			return match;
	}
}

function lookupValue(isWindows: boolean, envObj: NodeJS.ProcessEnv, args: string[], match: string, configFile: URI | undefined) {
	if (args.length > 0) {
		let envVariableName = args[0];
		if (isWindows) {
			envVariableName = envVariableName.toLowerCase();
		}
		const env = envObj[envVariableName];
		if (typeof env === 'string') {
			return env;
		}

		if (args.length > 1) {
			const defaultValue = args[1];
			return defaultValue;
		}

		// For `env` we should do the same as a normal shell does - evaluates missing envs to an empty string #46436
		return '';
	}
	throw new ContainerError({
		description: `'${match}'${configFile ? ` in ${path.posix.basename(configFile.path)}` : ''} can not be resolved because no environment variable name is given.`
	});
}

function devcontainerIdForLabels(idLabels: Record<string, string>): string {
	const stringInput = JSON.stringify(idLabels, Object.keys(idLabels).sort()); // sort properties
	const bufferInput = Buffer.from(stringInput, 'utf-8');
	const hash = crypto.createHash('sha256')
		.update(bufferInput)
		.digest();
	const uniqueId = BigInt(`0x${hash.toString('hex')}`)
		.toString(32)
		.padStart(52, '0');
	return uniqueId;
}