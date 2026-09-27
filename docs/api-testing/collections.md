---
title: "Collections"
description: "Organise requests in collections and folders with variables, inherited auth, scripts, import/export and versioning."
---

::: v-pre

# Collections

Collections hold folders and requests (REST and GraphQL), plus collection-level variables, auth (inherited by requests set to *Inherit*), and pre-request and test scripts.

Each collection is a versioned JSON file under `collections/` in the workspace, and its `version` increments on every save. Commit it to git for review and history.

## Import

**Import** accepts:

- OpenAPI 3 / Swagger 2 (JSON or YAML). Tags become folders, parameters and example bodies are generated, and security schemes map to auth.
- Postman v2.1 collections (including scripts, request descriptions and saved responses, which become [examples](#examples)) and environments.
- HAR files.
- Protolens collections and workspace exports.

The CLI can import too: `protolens import openapi.yaml -w my-workspace`.

## Examples

An example is a saved response of a request, like Postman's examples. Examples show what an endpoint returns without sending the request, for instance a success and an error case.

- **Save a response:** send a saved request, then click **Save as example** above the response and give it a name. The request must be in a collection. A new request opens the Save dialog first.
- **Browse:** the request's **Examples** tab lists its examples with their status. Select one to see its headers and body. Rename or delete it with the buttons at the top.
- **Safe to commit:** examples are stored in the collection file, so sensitive data is masked when you save one. `Set-Cookie`, `Authorization` and token headers become `REDACTED`, and so do sensitive JSON fields (`access_token`, `password` …) and known secret values. Headers that only describe one transfer (`Date`, `Content-Length` …) are dropped. Bodies over 512 KB and truncated previews can't be saved as examples.
- Examples are saved to the collection straight away and don't mark the request as changed. Saving the request keeps its examples.

In the collection file an example looks like this:

```json
{
  "id": "ex-patient-missing",
  "name": "Patient not found",
  "status": 404,
  "statusText": "Not Found",
  "headers": [{ "key": "content-type", "value": "application/json" }],
  "body": "{ \"error\": \"not_found\" }",
  "request": { "method": "GET", "url": "{{baseUrl}}/patients/999" }
}
```

`request` is optional. It records the request that produced the response when that differs from the saved request.

## Collection Runner

The Collection Runner works like Postman's. It runs a whole collection or one folder, one request at a time and in order. Open it from the **Run** tab or button of a collection, or choose **Run collection** or **Run folder** in the **⋯** menu of the request tree.

| Setting | What it does |
|---|---|
| Run | The whole collection or a single folder |
| Requests | Tick the requests to include (all by default) |
| Environment | Variables used for the run |
| Iterations | How many times to run the requests (defaults to the number of data rows, or 1) |
| Delay | Pause between requests, in milliseconds |
| Data | A CSV or JSON file. Each row becomes one iteration. Use `{{column}}` in requests, or `pm.iterationData.get('column')` in scripts. Click the file name to preview its rows |
| Keep variable values | Values set with `pm.environment.set()` and similar are saved as [current values](./rest.md#scripts) after the run. Turn this off to throw them away |
| Stop on first failure | End the run when a request fails or errors |

Variables set by a script carry over to the requests that follow. A token saved by **Get access token** is used by later requests that inherit bearer auth `{{accessToken}}`. Collection-level scripts run before each request's own scripts.

To control the order from scripts:

```js
// jump to a request by name or id
pm.execution.setNextRequest('List patients');
// end the current iteration
pm.execution.setNextRequest(null);
// in a pre-request script: skip this request (reported as skipped)
pm.execution.skipRequest();
```

`postman.setNextRequest()` works too. An iteration stops after 1,000 requests, so a `setNextRequest` loop can't run forever.

To run a collection from a terminal or CI, use [`protolens run-collection`](../cli/reference.md#run-collection). It runs the same way and also accepts Postman collection and environment files, like Newman.

Results stream into the panel on the right, with checks, errors and a trace for each request. Earlier runs are listed under **Previous runs**, and every run is saved with its HTML, Markdown, JUnit and JSON reports. With more than one iteration, each result is prefixed with its iteration number, for example `#2 Patients / List patients`.

:::
