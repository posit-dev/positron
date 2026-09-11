# McpFrontend


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**frontend_id** | **string** | The frontend\&#39;s ID; supply it again to re-register after a reconnect | [default to undefined]
**token** | **string** | The bearer token agents present to the MCP server. Scoped to this frontend and distinct from the supervisor API token. | [default to undefined]
**port** | **number** | The TCP port the MCP listener is bound to on 127.0.0.1 | [default to undefined]
**url** | **string** | The full MCP endpoint URL agents should connect to | [default to undefined]

## Example

```typescript
import { McpFrontend } from './api';

const instance: McpFrontend = {
    frontend_id,
    token,
    port,
    url,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
