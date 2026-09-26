---
title: "GraphQL schema explorer"
description: "Introspect a schema to enable autocomplete, validation, hover docs and type navigation."
---

::: v-pre

# Schema explorer

**Introspect** runs the standard introspection query and loads the schema:

- **Autocomplete** for fields, arguments, types, directives and variables (Ctrl+Space).
- **Validation** as you type, with errors underlined in the editor.
- **Hover** documentation for types.
- **Explorer** listing root types, all types (objects, interfaces, unions, enums, inputs, scalars) and directives. Click a type to drill down and a field to insert it. The **SDL** toggle shows the printed schema.

If introspection is disabled on the server, the error explains why and suggests alternatives.

:::
