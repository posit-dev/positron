/*
 * JupyterHistoryRequest.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from "./JupyterMessageSpec";

/**
 * Represents a history_request to the kernel
 * 
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#history
 */
export interface JupyterHistoryReply extends JupyterMessageSpec {
    /** The status of the request */
    status: 'ok' | 'error';

}
