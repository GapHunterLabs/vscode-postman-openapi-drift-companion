# Postman OpenAPI Drift Companion (VS Code)

Warns on a Postman collection endpoint whose method+path no longer
exists in the project's OpenAPI/Swagger spec — collections and specs
drift apart silently, a collection hand-edited or an endpoint
renamed/removed in the spec. No data leaves your editor.

**v0.1, pilot.** Part of the Gap Hunter Labs VS Code workstream,
ported from the IntelliJ-family `postman-openapi-drift-companion`.

## What it does

Open a `*.postman_collection.json` file and every request's path is
checked live against a nearby OpenAPI/Swagger spec
(`openapi.yaml`/`.yml`/`.json` or `swagger.yaml`/`.yml`/`.json`,
searched up to 6 directories above the collection). OpenAPI's `{id}`
and Postman's `:id`/`{{id}}` are both treated as matching wildcards; a
literal segment must match exactly.

**v0.1 scope, honestly noted (same as the IntelliJ-family original):**
`$ref` is not resolved — a spec that only declares paths via external
references produces an honestly empty set (never a false "path not
found" for those). Only directories on the path from the collection
to the root are searched, not the whole workspace. The OpenAPI/Swagger
scanner is line-oriented (same technique as the original), not a real
JSON/YAML parser — it expects a hand-edited, pretty-printed spec (the
normal case); a minified single-line JSON spec isn't read correctly.

## Privacy

See [PRIVACY.md](PRIVACY.md) — zero network calls, everything runs
against files already open in your workspace.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test
```

To build an installable package without publishing:

```bash
npx @vscode/vsce package
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
