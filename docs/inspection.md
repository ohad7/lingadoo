# Browser Inspection

Use the inspection runner when debugging real upload/editor behavior:

```bash
npm run inspect:browser -- --pdf ./tests/documents/report_1_test.pdf --block p1_b39
```

The runner starts a fresh Vite dev server unless `--url` is provided.

Useful options:

- `--page <number>`
- `--block <id>`
- `--source <label>`
- `--target <label>`
- `--mirror true|false`
- `--debug-inspections true|false`
- `--mock-translations <path>`
- `--pre-hook <path>`
- `--post-hook <path>`

Debug-only editor shortcuts are enabled by `?debugInspections=1` or `--debug-inspections true` in the inspection runner.
