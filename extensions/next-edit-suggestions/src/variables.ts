/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import type { Variable, VariablesContext } from './types.js';
import { log } from './extension.js';

const VARIABLE_LIMIT = 100;
const CHILDREN_LIMIT = 50;

export type { Variable, VariablesContext };

async function runtimeVariableExpanded(
	session: { runtimeMetadata: { languageId: string }; metadata: { sessionId: string } },
	variable: { display_name: string; display_type: string; has_children: boolean; access_key: string; kind?: string },
	level: number = 0,
	limit: number = CHILDREN_LIMIT,
	parentKey: string[] = [],
): Promise<Variable> {
	const accessKey = [...parentKey, variable.access_key];

	const shouldExpand =
		(session.runtimeMetadata.languageId === 'r' && variable.display_type.includes('list')) ||
		(session.runtimeMetadata.languageId === 'r' && variable.kind === 'table') ||
		(session.runtimeMetadata.languageId === 'python' && variable.display_type.includes('dict')) ||
		(session.runtimeMetadata.languageId === 'python' && variable.display_type.includes('DataFrame'));

	if (!shouldExpand || !variable.has_children || level === 0) {
		return {
			name: variable.display_name,
			type: variable.display_type,
		};
	}

	const children = (await positron.runtime.getSessionVariables(session.metadata.sessionId, [accessKey]))
		.flat()
		.slice(0, limit);
	return {
		name: variable.display_name,
		type: variable.display_type,
		children: await Promise.all(
			children.map((child: any) => runtimeVariableExpanded(session, child, level - 1, limit, accessKey)),
		),
	};
}

export async function getSessionVariables(
	first?: Set<string>,
	limit: number = VARIABLE_LIMIT,
): Promise<VariablesContext[]> {
	const match = first || new Set();
	const sessions = await positron.runtime.getActiveSessions();

	const sessionContexts = await Promise.all(
		sessions.map(async (session: any): Promise<VariablesContext | null> => {
			try {
				const runtimeVariables = await positron.runtime.getSessionVariables(session.metadata.sessionId);
				const flatVariables = runtimeVariables.flat();

				const referenced = flatVariables
					.filter((v: any) => match.has(v.display_name))
					.map((v: any) => ({ referenced: true, variable: v }));
				const notReferenced = flatVariables
					.filter((v: any) => !match.has(v.display_name))
					.map((v: any) => ({ referenced: false, variable: v }));
				const variablesToProcess = [...referenced, ...notReferenced].slice(0, limit);

				const variables = await Promise.all(
					variablesToProcess.map(async ({ referenced, variable }: { referenced: boolean; variable: any }) => {
						if (referenced) {
							return runtimeVariableExpanded(session, variable, 2);
						} else {
							return {
								name: variable.display_name,
								type: variable.display_type,
							};
						}
					}),
				);

				return {
					languageId: session.runtimeMetadata.languageId,
					variables,
				};
			} catch {
				log.warn(
					`Something went wrong getting session variables for session "${session.metadata.sessionId}". Using an empty variable set.`,
				);
				return null;
			}
		}),
	);

	return sessionContexts.filter((ctx): ctx is VariablesContext => ctx !== null);
}
