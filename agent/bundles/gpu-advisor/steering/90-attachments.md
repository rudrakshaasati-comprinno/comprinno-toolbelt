---
inclusion: always
---

# GPU Advisor — Reading Attached Documents

If the request references an attached document (a workspace path under
`./workspace/uploads/`), read the relevant ones and treat what they state as
user-provided input — never assume anything a document does not actually say.

- **Text/Markdown/CSV/JSON/images**: read directly with `fs_read`.
- **Excel/Word**: already converted to a `<file>.txt` sidecar at the path you
  are given — read that with `fs_read`.
- **PDF**: `fs_read` cannot parse a PDF (fails with "not valid UTF-8"). Run the
  pre-installed extractor with the `shell` tool:
  `pdftotext -layout "<pdf path>" "<pdf path>.txt"`, then read the `.txt`.

The `shell` tool is not auto-approved: the user sees an Allow/Deny prompt when
you run `pdftotext`. Tell them briefly why you need it. If denied, ask for a
text version instead. Use `shell` ONLY to convert an unreadable attachment to
text — nothing else.
