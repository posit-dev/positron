/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IOverlap, OverlapChoice } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { contextAround, fitsInOneRequest, ICombinationProposal, IProposeCombinationInput, proposeCombinationJob } from '../../common/agent/proposeCombination.js';
import { LARGE_FILE_LIMIT_BYTES } from '../../common/checkpointsLimits.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';
import { useAgentAvailable } from '../components/useChangesDescription.js';
import { projectRootUri } from '../projectRoot.js';

/** The language given to the model when the file's language cannot be told. */
const UNKNOWN_LANGUAGE = 'plaintext';

/** The services `readCombinationInput` uses. */
export interface ICombinationInputServices {
	checkpointsService: ICheckpointsService;
	fileService: IFileService;
	languageService: ILanguageService;
	workspaceContextService: IWorkspaceContextService;
}

/**
 * The input of the "propose combination" job for one text overlap. The context lines come from
 * the working file (see `contextAround`); a file that cannot be read, or that is over the large
 * file limit, gives no context. The language is guessed from the file's name and the first line
 * of the person's version.
 */
export async function readCombinationInput(services: ICombinationInputServices, overlap: IOverlap): Promise<IProposeCombinationInput> {
	const mine = overlap.mine ?? '';
	let resource = URI.file(`/${overlap.path}`);
	let context = { contextBefore: '', contextAfter: '' };
	const engine = services.checkpointsService.engine;
	try {
		if (engine) {
			const state = await engine.getState();
			resource = joinPath(projectRootUri(services.workspaceContextService, state.projectRoot), overlap.path);
			const content = await services.fileService.readFile(resource, { limits: { size: LARGE_FILE_LIMIT_BYTES } });
			context = contextAround(content.value.toString(), mine);
		}
	} catch {
		// No context: the versions alone still make a request.
	}
	const firstLine = mine.split(/\r?\n/, 1)[0];
	const language = services.languageService.guessLanguageIdByFilepathOrFirstLine(resource, firstLine) ?? UNKNOWN_LANGUAGE;
	return { overlap, ...context, language };
}

/** The state of the proposal for one overlap. */
export type CombinationProposalState =
	/** No proposal is requested: the agent is not available, or the overlap cannot have one. */
	| { status: 'none' }
	| { status: 'loading' }
	/** The job gave no proposal. Only the manual choices show. */
	| { status: 'failed' }
	/** `preselected` is true when the proposal became the person's choice as it arrived. */
	| { status: 'ready'; proposal: ICombinationProposal; preselected: boolean };

/**
 * Requests a combined text for a text overlap while the agent is available, once for each
 * overlap id (an id is made from the kind and the three versions, so the same id is the same
 * overlap). The request is cancelled when the component goes away, the overlap changes, or the
 * agent becomes unavailable.
 *
 * When a `high` confidence proposal arrives and `readChoice` gives no choice for the overlap, the
 * proposed text becomes the choice through `onChoose`. A proposal that arrives after the person
 * chose leaves the choice alone. Nothing is applied: the person still presses Apply. When the
 * agent becomes unavailable while the preselected text is still the choice, unedited, the choice
 * is cleared, so no model text stays selected after the person turned the agent off.
 *
 * @param readChoice Reads the current choice for the overlap where it is kept, so that a choice
 * made just before the proposal arrives is seen even before the component renders it.
 */
export function useCombinationProposal(
	overlap: IOverlap,
	readChoice: () => OverlapChoice | undefined,
	onChoose: (choice: OverlapChoice | undefined) => void
): CombinationProposalState {
	const services = usePositronReactServicesContext();
	const available = useAgentAvailable();
	const [state, setState] = useState<{ overlapId: string; state: CombinationProposalState }>();

	// The request reads the latest overlap and callbacks when it starts or finishes.
	const latest = useRef({ overlap, readChoice, onChoose });
	useLayoutEffect(() => {
		latest.current = { overlap, readChoice, onChoose };
	});

	const eligible = available && fitsInOneRequest(overlap);
	const overlapId = overlap.id;

	// The text that became the choice as the proposal arrived, for the overlap it was made for.
	const preselectedText = useRef<{ overlapId: string; content: string }>(undefined);
	useEffect(() => {
		if (available) {
			return;
		}
		const preselected = preselectedText.current;
		preselectedText.current = undefined;
		if (!preselected || preselected.overlapId !== latest.current.overlap.id) {
			return;
		}
		const choice = latest.current.readChoice();
		if (choice?.type === 'text' && choice.content === preselected.content) {
			latest.current.onChoose(undefined);
		}
	}, [available]);

	useEffect(() => {
		if (!eligible) {
			return;
		}
		const source = new CancellationTokenSource();
		const requested = latest.current.overlap;
		const settle = (next: CombinationProposalState) => {
			if (!source.token.isCancellationRequested) {
				setState({ overlapId, state: next });
			}
		};
		settle({ status: 'loading' });
		const request = async () => {
			const input = await readCombinationInput({
				checkpointsService: services.get(ICheckpointsService),
				fileService: services.get(IFileService),
				languageService: services.get(ILanguageService),
				workspaceContextService: services.get(IWorkspaceContextService),
			}, requested);
			if (source.token.isCancellationRequested) {
				return;
			}
			const outcome = await services.get(ICheckpointsAgentService).run(proposeCombinationJob, input, source.token);
			if (source.token.isCancellationRequested) {
				return;
			}
			if (!outcome.ok) {
				settle({ status: 'failed' });
				return;
			}
			const proposal = outcome.value;
			const preselected = proposal.confidence === 'high' && latest.current.readChoice() === undefined;
			if (preselected) {
				preselectedText.current = { overlapId, content: proposal.combined };
				latest.current.onChoose({ type: 'text', content: proposal.combined });
			}
			settle({ status: 'ready', proposal, preselected });
		};
		request().catch(error => {
			services.get(ILogService).error('A combination for the overlap could not be proposed.', error);
			settle({ status: 'failed' });
		});
		return () => source.dispose(true);
	}, [services, eligible, overlapId]);

	if (!eligible) {
		return { status: 'none' };
	}
	return state?.overlapId === overlapId ? state.state : { status: 'loading' };
}
