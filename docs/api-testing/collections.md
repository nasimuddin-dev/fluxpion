---
title: "Collections"
description: "Organise requests in collections and folders with variables, inherited auth, scripts, import/export and versioning."
---

::: v-pre

# Collections

Collections hold folders and requests (REST and GraphQL), plus collection-level variables, auth (inherited by requests set to *Inherit*), and pre-request and test scripts.

Each collection is a versioned JSON file under `collections/` in the workspace, and its `version` increments on every save. Commit it to git for review and history.

## Favorites

To keep frequently used endpoints close at hand, choose **Add to favorites** from a REST or GraphQL request's **⋯** menu. In the REST view, select the star beside **Filter requests** to show only favorites. Their parent folders stay visible so the request's place in the collection remains clear. Favorites are stored with the request in the collection JSON and can be removed from the same menu.

## Request menu

Right-click a request in the tree, or click its **⋯** button:

| Item | What it does |
|---|---|
| **Open in tab** | Open the request. |
| **Rename**, **Duplicate**, **Add to favorites** | Manage the request. |
| **Copy URL** | The URL with `{{variables}}` resolved from the active environment. |
| **Copy as cURL (bash)**, **cURL (cmd)**, **PowerShell**, **fetch** | A runnable command or code, like the browser's *Copy as …*, with variables resolved and inherited auth applied. `fetch` code also runs in Node.js 18+. |
| **More code snippets…** | Open the request with the code generator (Python, Go, Java, C#, HTTPie and more). |
| **Delete** | Delete the request after a confirmation. |

Copied commands include the request's real header and token values, so they run as they are, like Postman's *Copy as cURL*. When they do, the confirmation message says so. Folders have their own menu (Run, Edit folder, New request, New folder, Rename, Delete).

## Import

**Import** accepts:

- OpenAPI 3 / Swagger 2 (JSON or YAML). Tags become folders, parameters and example bodies are generated, and security schemes map to auth. The document is kept in the workspace's `specs/` folder and every request gets a [**Matches OpenAPI contract**](../test-runner/assertions.md#openapi-contract-testing) check, so running the collection tests the API against its own contract (`testpion import --no-contract-checks` leaves the checks out).
- Postman v2.1 collections (including scripts, request descriptions and saved responses, which become [examples](#examples)) and environments.
- HAR files.
- TestPion collections and workspace exports.
- A single request copied as cURL (bash or cmd), fetch or PowerShell. It is saved to the **Imported** collection, named after its method and path. Secrets in it (tokens, API keys, cookies, passwords) are replaced by `{{variables}}`, and a message lists the ones to add as secret environment variables. To just try the request without saving it, paste it into the REST view instead (see [paste a request](/api-testing/rest#paste-a-request-from-the-browser)).

A Postman import keeps collection-level and request scripts, path variables, OAuth 2.0 settings, GraphQL bodies (as GraphQL requests), descriptions and saved responses.

**Import…** in the workspace menu (top bar) accepts the same files. A TestPion workspace export opens as a new workspace, and anything else (a Postman collection or environment, OpenAPI, HAR) is added to the open workspace.

The CLI can import too: `testpion import openapi.yaml -w my-workspace`.

## Export

**Export** in a collection's toolbar offers two formats:

- **TestPion collection (.json)**: the collection file as it is stored in the workspace.
- **Postman collection v2.1**: for Postman, Newman or any tool that reads Postman collections. It includes folders, requests, params and path variables, headers, bodies (raw, form, multipart, file, GraphQL), auth (bearer, basic, API key, OAuth 1.0, OAuth 2.0, AWS Signature, Digest), collection and request scripts, collection variables, descriptions, saved examples and the *follow redirects* / *TLS verification* settings.

Postman has no place for some TestPion features. When they are left out, a message lists them:

- Assertions: a `status` check becomes a `pm.test(...)` in the request's test script, and other assertion types are skipped.
- JWT auth and the per-request Cookies table (its cookies are sent as a `Cookie` header instead).

Importing an exported file back into TestPion gives the same collection, and the round trip is tested. **Environments → Export** writes an environment in Postman's environment format. Secret variables are exported with an empty value and type `secret`, because their values stay in your OS credential store.

From the CLI:

```bash
testpion export "Veterinary API" -o vet.postman_collection.json          # Postman v2.1 (default)
testpion export "Veterinary API" -f testpion -o vet.collection.json
testpion export-environment Staging -o staging.postman_environment.json
```

## Examples

An example is a saved response of a request, like Postman's examples. Examples show what an endpoint returns without sending the request, for instance a success and an error case. A [mock server](/api-testing/mock-servers) serves them over HTTP.

- **Save a response:** send a saved request, then click **Save as example** above the response and give it a name. The request must be in a collection. A new request opens the Save dialog first.
- **Browse:** in the request tree, the chevron before a request lists its examples. The request's **Examples** tab lists them with their status. Select one to see its headers and body. Rename or delete it with the buttons at the top.
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

## Documentation

Collections document themselves, like Postman's API documentation:

- **Request docs:** each request has a **Docs** tab. Write Markdown on the left and see the preview on the right. The text is saved with the request.
- **Collection docs:** the collection's **Docs** tab renders the whole collection as one page. It starts with the collection description, then a table of contents, then every folder and request: method and URL, description, auth, path variables, query parameters, headers, body and saved examples. Click **Edit description** to write the collection description, with a live preview. Click **Save** to keep it.
- **Secrets stay out:** values of sensitive headers, parameters, variables and body fields are shown as `••••••` or `REDACTED`. References like `{{accessToken}}` are shown as written, since they are not secrets.
- **Export Markdown** downloads the page as a `.md` file, ready for a wiki, a README or a static site. The CLI does the same: `testpion docs "Veterinary API" -o API.md`.

Markdown is rendered with GitHub-flavoured syntax (tables, fenced code, task lists) and sanitised: scripts and event handlers are removed, and links open in your browser.

## Folders

Choose **Edit folder** in a folder's **⋯** menu to set up everything its requests share:

- **Scripts:** a pre-request and a post-response script that run for every request in the folder, including requests in sub-folders. The order is: collection script, outer folders' scripts, this folder's script, then the request's own script. It is the same for sending from a tab, the Collection Runner and `testpion run-collection`.
- **Variables:** visible to the requests inside. An inner folder's value wins over an outer folder's. Request variables and iteration data rows win over folder variables, and folder variables win over collection and environment variables.
- **Authorization:** requests set to *Inherit* use the nearest folder's auth, or the collection's.

Folders with scripts or variables show a dot in the tree. Folder scripts and variables are exported to and imported from Postman v2.1 (`event` and `variable` on folders).

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

Variables set by a script carry over to the requests that follow. A token saved by **Get access token** is used by later requests that inherit bearer auth `{{accessToken}}`. Collection-level and [folder-level](#folders) scripts run before each request's own scripts.

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

To run a collection from a terminal or CI, use [`testpion run-collection`](../cli/reference.md#run-collection). It runs the same way and also accepts Postman collection and environment files, like Newman.

Results stream into the panel on the right, with checks, errors and a trace for each request. Earlier runs are listed under **Previous runs**, and every run is saved with its HTML, Markdown, JUnit and JSON reports. With more than one iteration, each result is prefixed with its iteration number, for example `#2 Patients / List patients`.

:::
