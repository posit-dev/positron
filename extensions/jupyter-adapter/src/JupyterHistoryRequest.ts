/*
 * JupyterHistoryRequest.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Represents a history_request to the kernel
 * 
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#history
 */
export interface JupyterHistoryRequest extends JupyterMessageSpec {
    /** Whether to return output with the history */
    output: boolean;

    /** Whether to return the raw (not transformed) input */
    raw: boolean;

    /** The type of history being requested */
    hist_access_type: 'range' | 'tail' | 'search';  //eslint-disable-line

    /** For range requests, the session to retrieve from */
    session: number;

    /** For range requests, the point in history to start from */
    start: number;

    /** For range requests, the point in history to end at */
    end: number;

    /** For tail and search requests, the number of history entries to retrieve */
    n: number;

    /** For search requests, the pattern to search for (? and * wildcards supported) */
    pattern: string;

    /** For search requests, whether to include only unique search results */
    unique: boolean;
}
