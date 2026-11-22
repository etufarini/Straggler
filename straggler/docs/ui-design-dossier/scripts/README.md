# Advisory layout audit

With the fixture renderer running (`npm --prefix straggler/desktop run dev`):

```sh
node straggler/docs/ui-design-dossier/scripts/layout-audit.mjs before
node straggler/docs/ui-design-dossier/scripts/layout-audit.mjs after
node straggler/docs/ui-design-dossier/scripts/layout-audit.mjs review --review
```

Pass frozen capture HTML paths after the report name to inspect a saved dossier instead. Relative CSS/resources must remain beside those captures. Reports and screenshots go to `straggler/desktop/test-results/layout/<name>/`.

The audit uses the existing Playwright installation. It always exits successfully: measurements are review evidence, not a merge gate. Capture errors remain in the report and console summary. It compares painted boxes and glyph ranges, reports sibling horizontal offsets of 3–40 px and text action insets of at least 6 px, and records visible vertical gaps with the R009 bands (fields 24–30 px, notes 8–12 px, section boundaries 40–48 px; dialog fields 16–22 px including line leading).

Navigation selection boxes, intentionally indented reasoning, summary markers and message action groups are excluded from alignment diagnostics. Horizontal rows are excluded from sibling comparisons. Closed details content is excluded explicitly. Headings, compound controls and nested containers can produce advisory findings requiring visual review; a finding alone does not establish a defect.

This is a separate command because this checkout has no frozen dossier verifier. It preserves existing captured evidence and can inspect either that evidence or the current renderer without regenerating a dossier.
