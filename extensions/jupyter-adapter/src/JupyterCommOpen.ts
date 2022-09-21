/*
 * JupyterCommOpen.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

/**
 * Represents a request to open a new comm (communications channel)
 *
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#opening-a-comm
 */
export interface JupyterCommOpen {
    /** The ID of the comm (as a GUID) */
    comm_id: string;  // eslint-disable-line

    /** The name of the comm to open */
    target_name: string;   // eslint-disable-line

    /** Additional data to use to initialize the comm */
    data: object;
}
