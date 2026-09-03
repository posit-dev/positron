/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';

import { AgentCommand, expandTemplate, TemplateFlags, TemplateValues } from './templateExpander';

/** Subdirectory of the extension holding the skill templates. */
const TEMPLATES_DIR = 'templates';
/** Subdirectory of global storage holding the generated skills (the skill root). */
const SKILLS_DIR = 'skills';
/** File, next to the skills dir, recording the inputs the current output was built from. */
const STAMP_FILE = 'skills.stamp';

export interface GenerateResult {
	/** Absolute path of the generated skill root. */
	readonly skillRoot: string;
	/** Whether the output was rewritten this call (false when the stamp matched). */
	readonly regenerated: boolean;
	/** Command ids named by a template that no command provides -- i.e. drift. */
	readonly unresolved: readonly string[];
}

interface TemplateFile {
	/** Path relative to the templates dir, e.g. `positron-commands/SKILL.md`. */
	readonly relativePath: string;
	readonly content: string;
}

/** Collect every `.md` file under `dir`, recursively, with repo-relative paths. */
async function collectTemplates(dir: string, base: string = dir): Promise<TemplateFile[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files: TemplateFile[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectTemplates(full, base));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			files.push({
				relativePath: path.relative(base, full),
				content: await fs.readFile(full, 'utf8'),
			});
		}
	}
	return files;
}

/**
 * Remove staging and backup directories left behind by an interrupted run. Each
 * run uses a fresh UUID suffix, so a crash mid-swap orphans one; without this
 * sweep they would accumulate in global storage forever.
 */
async function sweepOrphans(storageDir: string, log: vscode.LogOutputChannel): Promise<void> {
	const entries = await fs.readdir(storageDir).catch(() => [] as string[]);
	const orphans = entries.filter(
		name => name.startsWith(`${SKILLS_DIR}.staging-`) || name.startsWith(`${SKILLS_DIR}.old-`),
	);
	await Promise.all(orphans.map(async name => {
		await fs.rm(path.join(storageDir, name), { recursive: true, force: true }).catch(() => { /* best effort */ });
		log.debug(`Removed orphaned skill directory ${name}.`);
	}));
}

/** Load agent-compatible commands as a lookup, including ones disabled right now. */
async function loadCommands(): Promise<ReadonlyMap<string, AgentCommand>> {
	const commands = await positron.ai.getAgentAllowedCommands({ includeDisabled: true });
	return new Map(commands.map(command => [command.id, command]));
}

/**
 * The Shiny commands whose Arguments and Returns the interactive-apps template
 * generates when the installed Shiny extension publishes agent metadata for
 * them. The extension ships out of this repo and older releases declare no
 * `agent` block at all, so the template keeps a hand-written fallback and the
 * `shiny_agent_metadata` flag picks between them. All of these must be present:
 * with metadata for only some of them the generated sections would be uneven,
 * and the hand-written text covers the whole family.
 */
const SHINY_AGENT_COMMANDS = ['shiny.python.runApp', 'shiny.r.runApp', 'shiny.stopApp'];

/**
 * Facts the templates may condition on: the environment, and what the installed
 * extensions publish. Stable for the life of the extension host, so they are
 * resolved once at generation time and the emitted text can be assertive rather
 * than hedging.
 */
function computeTemplateFlags(
	remoteAuthority: string,
	commandsById: ReadonlyMap<string, AgentCommand>,
): TemplateFlags {
	return {
		// Running in Posit Workbench: the Workbench server sets RS_SERVER_URL in
		// the session, and Workbench sessions are always the web UI. Matches
		// IS_RUNNING_ON_PWB in the positron-run-app extension.
		pwb: !!process.env.RS_SERVER_URL && vscode.env.uiKind === vscode.UIKind.Web,
		// The workspace lives behind a remote authority (Positron Server, Posit
		// Workbench, SSH, containers). The window then has no local `file`
		// filesystem, so a bare path argument to a renderer-side command like
		// `vscode.open` resolves to a `file://` URI nothing can read. Templates
		// use this to direct agents to fully-qualified vscode-remote:// URIs
		// (built with {{remote_authority}}) instead.
		remote: remoteAuthority !== '',
		// The window's files live on Windows, where a bare drive-letter path
		// does not parse as a path at all (`C:` reads as a URI scheme). This
		// extension runs in the workspace's extension host, so the platform
		// here is the platform the paths in an argument have to suit, remote or
		// not. Templates use this to keep the Windows-only URI advice out of a
		// macOS or Linux user's generated skill.
		windows: process.platform === 'win32',
		// The installed Shiny extension publishes agent metadata for its run and
		// stop commands, so their argument and return facts can be generated like
		// the Python ones instead of hand-written. False against a Shiny release
		// from before that metadata was added.
		shiny_agent_metadata: SHINY_AGENT_COMMANDS.every(id => commandsById.has(id)),
	};
}

/**
 * The window's remote authority (e.g. `localhost:8787`), from the `resolvers`
 * proposed API. Not derivable any other way in this (remote) extension host:
 * the authority is a client-side handshake fact, and the URI transformer
 * rewrites incoming vscode-remote URIs to `file`, so even workspace folder
 * URIs carry no authority here.
 * @returns The authority, or '' in a local window.
 */
function computeRemoteAuthority(): string {
	return vscode.env.remoteAuthority ?? '';
}

/**
 * A digest of everything the output depends on: the Positron build, the
 * extension version, the environment flags, the templates, and the command
 * metadata. When it is unchanged the cached output is reused, so an ordinary
 * launch does no writing.
 */
function computeStamp(
	templates: readonly TemplateFile[],
	commandsById: ReadonlyMap<string, AgentCommand>,
	extensionVersion: string,
	flags: TemplateFlags,
	remoteAuthority: string,
): string {
	const hash = crypto.createHash('sha256');
	hash.update(`positron:${vscode.version}\n`);
	hash.update(`extension:${extensionVersion}\n`);
	// Stable key order so the same flags always hash the same.
	const flagsJson = JSON.stringify(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)));
	hash.update(`flags:${flagsJson}\n`);
	hash.update(`remoteAuthority:${remoteAuthority}\n`);
	for (const template of [...templates].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
		hash.update(`template:${template.relativePath}\n${template.content}\n`);
	}
	// Stable key order so metadata reordering alone does not force a rebuild.
	const commandsJson = JSON.stringify([...commandsById.values()].sort((a, b) => a.id.localeCompare(b.id)));
	hash.update(`commands:${commandsJson}\n`);
	return hash.digest('hex');
}

/**
 * Expand the bundled templates against live command metadata and publish them
 * to a skill root in global storage. Idempotent: the output is rewritten only
 * when its inputs change. The write is staged in a sibling directory and
 * swapped in, so a consumer never observes a half-written root.
 */
export async function generateSkills(
	context: vscode.ExtensionContext,
	log: vscode.LogOutputChannel,
): Promise<GenerateResult> {
	const storageDir = context.globalStorageUri.fsPath;
	const skillRoot = path.join(storageDir, SKILLS_DIR);
	const stampPath = path.join(storageDir, STAMP_FILE);
	const templatesRoot = path.join(context.extensionUri.fsPath, TEMPLATES_DIR);

	await sweepOrphans(storageDir, log);

	const templates = await collectTemplates(templatesRoot);
	const commandsById = await loadCommands();
	// Drift is measured against this set, so record its size: an empty or partial
	// load turns every directive into apparent drift, and this line tells them apart.
	log.debug(`Loaded ${commandsById.size} agent command(s).`);
	const extensionVersion = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
	// Substituted for `{{remote_authority}}` so remote templates can spell out a
	// fully-qualified vscode-remote:// URI with the real authority baked in.
	// Empty on desktop, where no kept template branch references it.
	const remoteAuthority = computeRemoteAuthority();
	const flags = computeTemplateFlags(remoteAuthority, commandsById);
	const stamp = computeStamp(templates, commandsById, extensionVersion, flags, remoteAuthority);

	const existingStamp = await fs.readFile(stampPath, 'utf8').catch(() => undefined);
	const outputExists = await fs.stat(skillRoot).then(() => true, () => false);
	if (existingStamp === stamp && outputExists) {
		log.debug('Generated skills are up to date; nothing to rebuild.');
		return { skillRoot, regenerated: false, unresolved: [] };
	}

	const unresolved = new Set<string>();
	const runId = crypto.randomUUID();
	const stageDir = path.join(storageDir, `${SKILLS_DIR}.staging-${runId}`);
	const backupDir = path.join(storageDir, `${SKILLS_DIR}.old-${runId}`);
	try {
		for (const template of templates) {
			const values: TemplateValues = {
				// The skill's final absolute directory, so reference links are
				// absolute. The assistant reads a bare relative link relative to
				// the user's workspace, where the skill does not live.
				skill_dir: path.join(skillRoot, template.relativePath.split(path.sep)[0]),
				remote_authority: remoteAuthority,
			};
			const result = expandTemplate(template.content, commandsById, flags, values);
			result.unresolved.forEach(id => unresolved.add(id));
			// Authoring errors, not environment drift: surface them per template.
			if (result.unknownFlags.length > 0) {
				log.warn(`Template ${template.relativePath} names unknown flag(s): ${result.unknownFlags.join(', ')}`);
			}
			if (result.unbalanced.length > 0) {
				log.warn(`Template ${template.relativePath} has unbalanced conditional marker(s): ${result.unbalanced.join(', ')}`);
			}
			if (result.sameFlagNesting.length > 0) {
				log.warn(`Template ${template.relativePath} nests a flag inside itself: ${result.sameFlagNesting.join(', ')}`);
			}
			if (result.unknownValues.length > 0) {
				log.warn(`Template ${template.relativePath} names unknown value(s): ${result.unknownValues.join(', ')}`);
			}
			const target = path.join(stageDir, template.relativePath);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, result.text, 'utf8');
		}
		// Swap the staged output into place. Remove the stamp first so a crash
		// mid-swap leaves no stamp claiming the (now stale) output is current.
		await fs.rm(stampPath, { force: true });
		// Move the old root aside, then rename the new one in. The two renames
		// run back to back with no I/O between them, so the window where the root
		// is absent is a single metadata op rather than a recursive delete. If the
		// second rename fails, the old output is restored instead of lost.
		if (outputExists) {
			await fs.rename(skillRoot, backupDir);
		}
		try {
			await fs.rename(stageDir, skillRoot);
		} catch (error) {
			if (outputExists) {
				await fs.rename(backupDir, skillRoot).catch(() =>
					// Restore failed too: the root is now missing entirely. Flag it
					// distinctly since the outer error only describes the swap.
					log.warn(`Could not restore the previous skill root at ${skillRoot}; it is now absent.`),
				);
			}
			throw error;
		}
		await fs.writeFile(stampPath, stamp, 'utf8');
	} finally {
		await fs.rm(stageDir, { recursive: true, force: true });
		await fs.rm(backupDir, { recursive: true, force: true });
	}

	if (unresolved.size > 0) {
		log.warn(
			`Templates name ${unresolved.size} command id(s) that no command provides; ` +
			`their argument and return blocks were left empty: ${[...unresolved].join(', ')}`,
		);
	}
	log.info(`Generated ${templates.length} skill file(s) at ${skillRoot}.`);
	return { skillRoot, regenerated: true, unresolved: [...unresolved] };
}
