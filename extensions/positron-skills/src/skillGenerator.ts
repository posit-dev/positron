/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';

import { AgentCommand, expandTemplate } from './templateExpander';

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
 * A digest of everything the output depends on: the Positron build, the
 * extension version, the templates, and the command metadata. When it is
 * unchanged the cached output is reused, so an ordinary launch does no writing.
 */
function computeStamp(
	templates: readonly TemplateFile[],
	commandsById: ReadonlyMap<string, AgentCommand>,
	extensionVersion: string,
): string {
	const hash = crypto.createHash('sha256');
	hash.update(`positron:${vscode.version}\n`);
	hash.update(`extension:${extensionVersion}\n`);
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
	const extensionVersion = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
	const stamp = computeStamp(templates, commandsById, extensionVersion);

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
			const result = expandTemplate(template.content, commandsById);
			result.unresolved.forEach(id => unresolved.add(id));
			// Resolve `{{skill_dir}}` to the skill's final absolute directory so
			// reference links are absolute. The assistant reads a bare relative link
			// relative to the user's workspace, where the skill does not live.
			const skillDir = path.join(skillRoot, template.relativePath.split(path.sep)[0]);
			const text = result.text.split('{{skill_dir}}').join(skillDir);
			const target = path.join(stageDir, template.relativePath);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, text, 'utf8');
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
				await fs.rename(backupDir, skillRoot).catch(() => { /* leave the failure to surface */ });
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
