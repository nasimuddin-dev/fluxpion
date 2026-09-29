---
title: "Mock servers"
description: "Serve a collection's saved examples on localhost to build and test clients before the real API exists."
---

::: v-pre

# Mock servers

A mock server answers HTTP requests with the [saved examples](/api-testing/collections#examples) of a collection, like a Postman mock server. Use it to build a front end or client before the API exists, to test error handling, or to work offline.

Mock servers run on your computer only. They listen on `127.0.0.1` and are never reachable from other machines.

## Start one

**In the app:** open **Collections**, select a collection and open the **Mock** tab. The tab lists the routes the collection's examples provide. Pick a port (or leave it empty for any free port), optionally a delay, and click **Start mock server**. Copy the URL and use it as `{{baseUrl}}`, for example in a new *Mock* environment. Requests to the server appear below the routes as they arrive. Click a route to open its request.

The server follows the collection: examples you save, rename or delete are served straight away. It stops when you click **Stop**, switch workspace or close the app.

**From the CLI:**

```bash
testpion mock "Veterinary API" -p 4545
# Mock server for Veterinary API: http://127.0.0.1:4545
#   GET     /patients/1 → 200 Patient found
#   GET     /patients/999 → 404 Patient not found
```

A Postman collection file with saved responses works too: `testpion mock api.postman_collection.json`.

## How a request finds its example

Every example is a route: the method and path of the example's request (or of the saved request when the example has none). The host part is ignored, so `{{baseUrl}}/patients/1` and `https://api.example.com/patients/1` both become `/patients/1`.

1. **Method and path must match.** Path segments written as `:id` or `{{id}}` match any value. Literal segments must be equal and score higher, so `/patients/999` wins over `/patients/:id` for that exact path.
2. **Pick an example explicitly** with a request header:
   - `x-mock-response-name: Patient not found` selects the example with that name.
   - `x-mock-response-code: 404` selects an example with that status.
3. **Otherwise the best match wins.** Query parameters equal to the example's score higher, and a 2xx example wins a tie.
4. **Ids are flexible.** If nothing matches exactly, id-like segments in saved URLs (`/patients/1`, UUIDs, long hex ids) match any value. `/patients/42` is then answered by the `/patients/1` example.

The response has the example's status, headers and body, plus `x-mock-example: <name>` and permissive CORS headers so a browser app on another port can call it. A request that matches no example gets `404` with a JSON list of the available routes.

:::
