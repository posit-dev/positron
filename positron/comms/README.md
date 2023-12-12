## Positron Comm Contracts

This directory contains the [OpenRPC](https://open-rpc.org/) contracts for most of Positron's custom comm channels. The RPCs that pass through these channels are delivered as [Jupyter Custom messsages](https://jupyter-client.readthedocs.io/en/stable/messaging.html#custom-messages).

### Structure

Each Positron comm has three files in this folder.

#### Comm Metadata ({comm}.json)

This file contains metadata about the comm itself rather than the messages delivered on the comm. There are only 3 metadata fields:

| field | value |
| --- | --- |
| `name` | The name of the comm |
| `initiator` | Either `frontend` or `backend`; indicates who opens the comm |
| `initial_data` | A JSON Schema defining the initial data that is expected to be delivered when the comm is opened |

## Making Changes

To make changes


