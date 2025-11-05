/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CLIHost, runCommand, runCommandNoPty, ExecFunction, ExecParameters, Exec, PtyExecFunction, PtyExec, PtyExecParameters, plainExecAsPtyExec, PlatformInfo } from '../spec-common/commonUtils';
import { toErrorText } from '../spec-common/errors';
import * as ptyType from 'node-pty';
import { Log, makeLog } from '../spec-utils/log';
import { Event } from '../spec-utils/event';
import { escapeRegExCharacters } from '../spec-utils/strings';
import { delay } from '../spec-common/async';

export interface ContainerDetails {
	Id: string;
	Created: string;
	Name: string;
	State: {
		Status: string;
		StartedAt: string;
		FinishedAt: string;
	};
	Config: {
		Image: string;
		User: string;
		Env: string[] | null;
		Labels: Record<string, string | undefined> | null;
	};
	Mounts: {
		Type: string;
		Name?: string;
		Source: string;
		Destination: string;
	}[];
	NetworkSettings: {
		Ports: Record<string, {
			HostIp: string;
			HostPort: string;
		}[] | null>;
	};
	Ports: {
		IP: string;
		PrivatePort: number;
		PublicPort: number;
		Type: string;
	}[];
}

export interface DockerCLIParameters {
	cliHost: CLIHost;
	dockerCLI: string;
	dockerComposeCLI: () => Promise<DockerComposeCLI>;
	env: NodeJS.ProcessEnv;
	output: Log;
	platformInfo: PlatformInfo;
}

export interface PartialExecParameters {
	exec: ExecFunction;
	cmd: string;
	args?: string[];
	env: NodeJS.ProcessEnv;
	output: Log;
	print?: boolean | 'continuous' | 'onerror';
}

export interface PartialPtyExecParameters {
	ptyExec: PtyExecFunction;
	exec: ExecFunction; // for fallback operation
	cmd: string;
	args?: string[];
	env: NodeJS.ProcessEnv;
	output: Log;
	onDidInput?: Event<string>;
}

interface DockerResolverParameters {
	dockerCLI: string;
	isPodman: boolean;
	dockerComposeCLI: () => Promise<DockerComposeCLI>;
	dockerEnv: NodeJS.ProcessEnv;
	common: {
		cliHost: CLIHost;
		output: Log;
	};
}

export interface DockerComposeCLI {
	version: string;
	cmd: string;
	args: string[];
}

export async function inspectContainer(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, id: string): Promise<ContainerDetails> {
	return (await inspectContainers(params, [id]))[0];
}

export async function inspectContainers(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ids: string[]): Promise<ContainerDetails[]> {
	const results = await inspect<ContainerDetails>(params, 'container', ids);
	for (const result of results) {
		result.Ports = [];
		const rawPorts = result.NetworkSettings.Ports;
		for (const privatePortAndType in rawPorts) {
			const [PrivatePort, Type] = privatePortAndType.split('/');
			for (const targetPort of rawPorts[privatePortAndType] || []) {
				const { HostIp: IP, HostPort: PublicPort } = targetPort;
				result.Ports.push({
					IP,
					PrivatePort: parseInt(PrivatePort),
					PublicPort: parseInt(PublicPort),
					Type
				});
			}
		}
	}
	return results;
}

export interface ImageDetails {
	Id: string;
	Architecture: string;
	Variant?: string;
	Os: string;
	Config: {
		User: string;
		Env: string[] | null;
		Labels: Record<string, string | undefined> | null;
		Entrypoint: string[] | null;
		Cmd: string[] | null;
	};
}

export async function inspectImage(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, id: string): Promise<ImageDetails> {
	return (await inspect<ImageDetails>(params, 'image', [id]))[0];
}

async function inspect<T>(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, type: 'container' | 'image' | 'volume', ids: string[]): Promise<T[]> {
	if (!ids.length) {
		return [];
	}
	const partial = toExecParameters(params);
	const result = await runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(['inspect', '--type', type, ...ids]),
	});
	try {
		return JSON.parse(result.stdout.toString());
	} catch (err) {
		console.error({
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
		});
		throw err;
	}
}

export async function listContainers(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, all = false, labels: string[] = []) {
	const filterArgs = [];
	if (all) {
		filterArgs.push('-a');
	}
	for (const label of labels) {
		filterArgs.push('--filter', `label=${label}`);
	}
	const result = await dockerCLI(params, 'ps', '-q', ...filterArgs);
	return result.stdout
		.toString()
		.split(/\r?\n/)
		.filter(s => !!s);
}

export async function removeContainer(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, nameOrId: string) {
	let eventsProcess: Exec | undefined;
	let removedSeenP: Promise<void> | undefined;
	try {
		for (let i = 0, n = 7; i < n; i++) {
			try {
				await dockerCLI(params, 'rm', '-f', nameOrId);
				return;
			} catch (err) {
				// https://github.com/microsoft/vscode-remote-release/issues/6509
				const stderr: string = err?.stderr?.toString().toLowerCase() || '';
				if (i === n - 1 || !stderr.includes('already in progress')) {
					throw err;
				}
				if (!removedSeenP) {
					eventsProcess = await getEvents(params, {
						container: [nameOrId],
						event: ['destroy'],
					});
					removedSeenP = new Promise<void>(resolve => {
						eventsProcess!.stdout.on('data', () => {
							resolve();
							eventsProcess!.terminate();
							removedSeenP = new Promise(() => {}); // safeguard in case we see the 'removal already in progress' error again
						});
					});
				}
				await Promise.race([removedSeenP, delay(1000)]);
			}
		}
	} finally {
		if (eventsProcess) {
			eventsProcess.terminate();
		}
	}
}

export async function getEvents(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, filters?: Record<string, string[]>) {
	const { exec, cmd, args, env, output } = toExecParameters(params);
	const filterArgs = [];
	for (const filter in filters) {
		for (const value of filters[filter]) {
			filterArgs.push('--filter', `${filter}=${value}`);
		}
	}
	const format = 'isPodman' in params && params.isPodman ? 'json' : '{{json .}}'; // https://github.com/containers/libpod/issues/5981
	const combinedArgs = (args || []).concat(['events', '--format', format, ...filterArgs]);

	const p = await exec({
		cmd,
		args: combinedArgs,
		env,
		output,
	});

	const stderr: Buffer[] = [];
	p.stderr.on('data', data => stderr.push(data));

	p.exit.then(({ code, signal }) => {
		if (stderr.length) {
			output.write(toErrorText(Buffer.concat(stderr).toString()));
		}
		if (code || (signal && signal !== 'SIGKILL')) {
			output.write(toErrorText(`Docker events terminated (code: ${code}, signal: ${signal}).`));
		}
	}, err => {
		output.write(toErrorText(err && (err.stack || err.message)));
	});

	return p;
}

export async function dockerBuildKitVersion(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters): Promise<{ versionString: string; versionMatch?: string } | undefined> {
	try {
		const execParams = {
			...toExecParameters(params),
			print: true,
		};
		const result = await dockerCLI(execParams, 'buildx', 'version');
		const versionString = result.stdout.toString();
		const versionMatch = versionString.match(/(?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)/);
		if (!versionMatch) {
			return { versionString };
		}
		return { versionString, versionMatch: versionMatch[0] };
	} catch {
		return undefined;
	}
}

export async function dockerCLI(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toExecParameters(params);
	return runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function isPodman(params: PartialExecParameters) {
	try {
		const { stdout } = await dockerCLI(params, '-v');
		return stdout.toString().toLowerCase().indexOf('podman') !== -1;
	} catch (err) {
		return false;
	}
}

export async function dockerPtyCLI(params: PartialPtyExecParameters | DockerResolverParameters | DockerCLIParameters, ...args: string[]) {
	const partial = toPtyExecParameters(params);
	return runCommand({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function dockerComposeCLI(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
	return runCommandNoPty({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export async function dockerComposePtyCLI(params: DockerCLIParameters | PartialPtyExecParameters | DockerResolverParameters, ...args: string[]) {
	const partial = toPtyExecParameters(params, 'dockerComposeCLI' in params ? await params.dockerComposeCLI() : undefined);
	return runCommand({
		...partial,
		args: (partial.args || []).concat(args),
	});
}

export function dockerExecFunction(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, containerName: string, user: string | undefined, allocatePtyIfPossible = false): ExecFunction {
	return async function (execParams: ExecParameters): Promise<Exec> {
		const { exec, cmd, args, env } = toExecParameters(params);
		// Spawning without node-pty: `docker exec` only accepts -t if stdin is a TTY. (https://github.com/devcontainers/cli/issues/606)
		const canAllocatePty = allocatePtyIfPossible && process.stdin.isTTY && execParams.stdio?.[0] === 'inherit';
		const { argsPrefix, args: execArgs } = toDockerExecArgs(containerName, user, execParams, canAllocatePty);
		return exec({
			cmd,
			args: (args || []).concat(execArgs),
			env,
			stdio: execParams.stdio,
			output: replacingDockerExecLog(execParams.output, cmd, argsPrefix),
		});
	};
}

export async function dockerPtyExecFunction(params: PartialPtyExecParameters | DockerResolverParameters, containerName: string, user: string | undefined, loadNativeModule: <T>(moduleName: string) => Promise<T | undefined>, allowInheritTTY: boolean): Promise<PtyExecFunction> {
	const pty = await loadNativeModule<typeof ptyType>('node-pty');
	if (!pty) {
		const plain = dockerExecFunction(params, containerName, user, true);
		return plainExecAsPtyExec(plain, allowInheritTTY);
	}

	return async function (execParams: PtyExecParameters): Promise<PtyExec> {
		const { ptyExec, cmd, args, env } = toPtyExecParameters(params);
		const { argsPrefix, args: execArgs } = toDockerExecArgs(containerName, user, execParams, true);
		return ptyExec({
			cmd,
			args: (args || []).concat(execArgs),
			env,
			output: replacingDockerExecLog(execParams.output, cmd, argsPrefix),
		});
	};
}

function replacingDockerExecLog(original: Log, cmd: string, args: string[]) {
	return replacingLog(original, `Run: ${cmd} ${(args || []).join(' ').replace(/\n.*/g, '')}`, 'Run in container:');
}

function replacingLog(original: Log, search: string, replace: string) {
	const searchR = new RegExp(escapeRegExCharacters(search), 'g');
	const wrapped = makeLog({
		...original,
		get dimensions() {
			return original.dimensions;
		},
		event: e => original.event('text' in e ? {
			...e,
			text: e.text.replace(searchR, replace),
		} : e),
	});
	return wrapped;
}

function toDockerExecArgs(containerName: string, user: string | undefined, params: ExecParameters | PtyExecParameters, pty: boolean) {
	const { env, cwd, cmd, args } = params;
	const execArgs = ['exec', '-i'];
	if (pty) {
		execArgs.push('-t');
	}
	if (user) {
		execArgs.push('-u', user);
	}
	if (env) {
		Object.keys(env)
			.forEach(key => execArgs.push('-e', `${key}=${env[key]}`));
	}
	if (cwd) {
		execArgs.push('-w', cwd);
	}
	execArgs.push(containerName);
	const argsPrefix = execArgs.slice();
	execArgs.push(cmd);
	if (args) {
		execArgs.push(...args);
	}
	return { argsPrefix, args: execArgs };
}

export function toExecParameters(params: DockerCLIParameters | PartialExecParameters | DockerResolverParameters, compose?: DockerComposeCLI): PartialExecParameters {
	return 'dockerEnv' in params ? {
		exec: params.common.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.dockerEnv,
		output: params.common.output,
	} : 'cliHost' in params ? {
		exec: params.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.env,
		output: params.output,
	} : {
		...params,
		env: params.env,
	};
}

export function toPtyExecParameters(params: DockerCLIParameters | PartialPtyExecParameters | DockerResolverParameters, compose?: DockerComposeCLI): PartialPtyExecParameters {
	return 'dockerEnv' in params ? {
		ptyExec: params.common.cliHost.ptyExec,
		exec: params.common.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.dockerEnv,
		output: params.common.output,
	} : 'cliHost' in params ? {
		ptyExec: params.cliHost.ptyExec,
		exec: params.cliHost.exec,
		cmd: compose ? compose.cmd : params.dockerCLI,
		args: compose ? compose.args : [],
		env: params.env,
		output: params.output,
	} : {
		...params,
		env: params.env,
	};
}

export function toDockerImageName(name: string) {
	// https://docs.docker.com/engine/reference/commandline/tag/#extended-description
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\._-]+/g, '')
		.replace(/(\.[\._-]|_[\.-]|__[\._-]|-+[\._])[\._-]*/g, (_, a) => a.substr(0, a.length - 1));
}
