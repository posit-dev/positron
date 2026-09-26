/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

/** The name agents see the server under, and prefix its tools with. */
export const MCP_SERVER_NAME = 'positron';

/** Environment variable naming the MCP endpoint in integrated terminals. */
export const MCP_URL_ENV_VAR = 'POSITRON_MCP_URL';

/** Environment variable carrying the MCP bearer token. */
export const MCP_TOKEN_ENV_VAR = 'POSITRON_MCP_TOKEN';

/** The version stamped into the files below, so a reader can tell the shape. */
const MCP_DESCRIPTOR_VERSION = 1;

/** A live MCP registration: everything an agent needs in order to connect. */
export interface McpConnection {
	/** The workspace ID issued by the supervisor. */
	workspaceId: string;

	/** The workspace's name, as the user sees it. */
	displayName: string;

	/** The port the listener is bound to. */
	port: number;

	/** The bearer token agents present. Never logged. */
	token: string;

	/** The MCP endpoint URL. */
	url: string;

	/**
	 * The workspace's folders, by which the stdio bridge finds the workspace
	 * an agent is working in.
	 */
	folders: string[];
}

/**
 * The connection descriptor written for a registered workspace: its endpoint
 * and credential, for the stdio bridge and anything else that reads it.
 */
export interface McpConnectionDescriptor {
	version: number;
	workspaceId: string;
	displayName: string;
	port: number;
	url: string;
	token: string;
	folders: string[];

	/**
	 * When a window of the workspace last registered or took focus, as an ISO
	 * 8601 UTC timestamp, which sorts chronologically as text.
	 */
	lastActive: string;
}

/** One workspace as the index lists it. */
export interface McpIndexEntry {
	/** The descriptor holding this workspace's token. */
	descriptor: string;

	/** The workspace's folders, so a reader can find it by directory. */
	folders: string[];

	/**
	 * When the workspace was last active, so a reader can prefer the one the
	 * user is working in when two list the same folder.
	 */
	lastActive: string;
}

/**
 * The index of every workspace registered on this machine, which is where a
 * reader that does not already know a workspace ID starts.
 *
 * Deliberately carries no tokens: the descriptor each entry points at is the
 * one place a workspace's credential lives, so a reader never has to decide
 * which copy to trust.
 */
export interface McpConnectionIndex {
	version: number;
	workspaces: Record<string, McpIndexEntry>;
}

/**
 * The descriptor for a live registration.
 *
 * @param connection The live registration.
 * @returns The descriptor to write.
 */
function connectionDescriptor(connection: McpConnection): McpConnectionDescriptor {
	return {
		version: MCP_DESCRIPTOR_VERSION,
		workspaceId: connection.workspaceId,
		displayName: connection.displayName,
		port: connection.port,
		url: connection.url,
		token: connection.token,
		folders: connection.folders,
		lastActive: new Date().toISOString(),
	};
}

/**
 * The directory holding the index and descriptors, which the stdio bridge is
 * pointed at.
 *
 * @param storageUri The extension's global storage directory.
 * @returns The path to the directory.
 */
export function mcpConnectionsDirectory(storageUri: vscode.Uri): string {
	return path.join(storageUri.fsPath, 'mcp');
}

/**
 * The file listing every workspace registered on this machine.
 *
 * @param storageUri The extension's global storage directory.
 * @returns The path to the index.
 */
export function mcpIndexPath(storageUri: vscode.Uri): string {
	return path.join(mcpConnectionsDirectory(storageUri), 'connections.json');
}

/**
 * The file holding a workspace's connection descriptor.
 *
 * @param storageUri The extension's global storage directory.
 * @param workspaceId The workspace ID the supervisor issued.
 * @returns The path to the descriptor.
 */
export function mcpDescriptorPath(storageUri: vscode.Uri, workspaceId: string): string {
	return path.join(descriptorDirectory(storageUri), fileName(workspaceId));
}

/**
 * Write everything a registration publishes to disk: the workspace's
 * descriptor and the index that leads to it. Writing marks the workspace as
 * the most recently active.
 *
 * Kept in the extension's global storage rather than beside the workspace,
 * where it would be committed, and owner-only, since the descriptor holds a
 * token that lets an agent run code.
 *
 * @param storageUri The extension's global storage directory.
 * @param connection The live registration.
 */
export async function writeConnectionFiles(
	storageUri: vscode.Uri,
	connection: McpConnection,
): Promise<void> {
	await writeJsonFile(
		mcpDescriptorPath(storageUri, connection.workspaceId),
		connectionDescriptor(connection));
	await writeIndex(storageUri);
}

/**
 * Remove a workspace's files and take it out of the index.
 *
 * @param storageUri The extension's global storage directory.
 * @param connection The registration being given up.
 */
export async function removeConnectionFiles(
	storageUri: vscode.Uri,
	connection: McpConnection,
): Promise<void> {
	await fs.rm(mcpDescriptorPath(storageUri, connection.workspaceId), { force: true });
	await writeIndex(storageUri);
}

/** Where the per-workspace descriptors live. */
function descriptorDirectory(storageUri: vscode.Uri): string {
	return path.join(mcpConnectionsDirectory(storageUri), 'workspaces');
}

/**
 * A workspace ID as a file name. The ID is a slug the supervisor mints from the
 * workspace name; encoding it keeps a surprising one from naming a file outside
 * the directory, and the directory it is encoded into keeps it from colliding
 * with a file of ours.
 */
function fileName(workspaceId: string): string {
	return `${encodeURIComponent(workspaceId)}.json`;
}

/**
 * Rebuild the index from the descriptors on disk.
 *
 * Derived rather than edited in place, so that two windows registering at once
 * cannot drop each other's entry, and so a descriptor removed by hand stops
 * being advertised. A window that crashed leaves its descriptor behind and
 * stays listed; its endpoint refuses the connection, which is the only honest
 * liveness test a file can offer.
 *
 * @param storageUri The extension's global storage directory.
 */
async function writeIndex(storageUri: vscode.Uri): Promise<void> {
	const directory = descriptorDirectory(storageUri);
	const workspaces: Record<string, McpIndexEntry> = {};
	let names: string[] = [];
	try {
		names = await fs.readdir(directory);
	} catch {
		// Nothing has been registered on this machine yet.
	}
	for (const name of names.filter(entry => entry.endsWith('.json'))) {
		const descriptorPath = path.join(directory, name);
		try {
			const descriptor: McpConnectionDescriptor =
				JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
			workspaces[descriptor.workspaceId] = {
				descriptor: descriptorPath,
				folders: descriptor.folders ?? [],
				lastActive: descriptor.lastActive,
			};
		} catch {
			// A descriptor we cannot read is left out rather than making the
			// whole index unwritable.
		}
	}
	const index: McpConnectionIndex = { version: MCP_DESCRIPTOR_VERSION, workspaces };
	await writeJsonFile(mcpIndexPath(storageUri), index);
}

/**
 * Write a JSON file owner-only, and in one step: a client may read any of these
 * at any moment, and half a file is worse than an old one.
 *
 * @param file The file to write.
 * @param value The value to serialize into it.
 */
async function writeJsonFile(file: string, value: unknown): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await fs.rename(temporary, file);
}
