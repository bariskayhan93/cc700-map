# Review harness

One review covers the commits of one range. It has two parts: the machine gates, then the manual checks. Run
both before a device pack, and after a day of changes.

```sh
python3 -I tools/review_gate.py --since <first commit of the range>^ --image --tests
```

## Part 1: machine gates (`tools/review_gate.py`)

| Gate | Rule | Check | Fail means |
|---|---|---|---|
| G1 | The repo is public | No tracked `.local/` path or binary (`.bin`, `.gpx`, `.fit`, `.ccwb`, `.elf`). No coordinate pair in the added lines | Remove it from the commit before a push |
| G2 | A test that does not run does not exist | Every `tools/test_*.mjs` of the range is in `tools/validate_local.py` | Add it to the runner |
| G3 | No library on the unit, no writable globals, integer core | Host build with `-Wall -Wextra -Wshadow -Wvla -Werror`; no `memcpy`, `malloc` (stock allocator in `mapdec` only), no file-scope variable, no `float` in `wayback.c`, `wb_grey.c`, `mapdec.c` | Fix the C |
| G4 | Bounded stack | Deepest path from `wb_rt` in the device compiler call graph (`-fcallgraph-info=su`), an upper bound, below `WBD_STACK` (3,968 B). It also prints the room left for the stock calls | Make the frame smaller, or raise `WBD_STACK` |
| G5 | One value for each limit | The same limit has the same value in C, page and builder (line points, block read, grey cell, quantum, distance, length, piece, entry points, code area) | Change the side that is wrong |
| G6 | One live format for each layer | Prints the writers of each format (information) | A format with no reader on any unit must go |
| G7 | The image on the card is the reviewed source | Rebuilds the pack image from the sources at its commit; SHA-256 must match `manifest-cc26.json`. No source change since that commit | Rebuild and update the card |
| G8 | Text and data agree | The release text names an image file that has the pack SHA-256, and states its SHA-256, bytes and code bytes | Fix the text |
| G9 | Tests pass | `validate_local.py` (exit 0, or 2 for the known gaps), then each suite that the runner does not run | Fix the code or the test |

## Part 2: manual checks

Read each changed file of the range. Answer each question with a finding (one claim, `file:line`, the fix) or
"none". Rank the findings: device safety, then wrong data, then limits, then simplicity.

### A. Device safety (owner rules, `cc700-fix-forward`, AGENTS.md)

1. Does every new path end in the stock display when data is absent, bad or late (fallback)?
2. Is every loop bounded by a constant or a checked count? Is every read range checked against the file size?
3. Is every time limit (300 ms file work, 60 ms grey) checked in each loop that reads a file?
4. Does a deeper call chain (G4) leave the stock calls at least the room they had on the last ride-tested image?
5. Does each device script stop before its first write when a check fails, also under `python -O`?
6. Does each write step write only the planned addresses, and verify by readback?

### B. Data and format

1. Do the page writer and the unit reader agree on each field: bit position, width, unit, sign?
2. Does every field overflow give an error that names the field (no silent cut)?
3. Does the page drop the optional data (way-back, grey layer) when it does not fit, and keep the route?
4. Does each new format have one writer and one reader, with a host round-trip test?

### C. Limits (`map-limits.md`, `cc700-resource-rules`)

1. Is each new cap measured on the 17 Nov ride and the 70 km walk, or named as an estimate?
2. Does a cap hide useful output? Example: a line that is too long gives a code instead of a line.
3. Does any change raise a production budget from an offline run? It must not.

### D. Simplicity (`cc700-simplicity-first`, `cc700-resource-rules`)

1. Is a new hook added? Only the frozen hooks are allowed.
2. Is there dead code, an unused option, or a second form of the same thing?
3. Does a name or a comment say something that is not true now (old version, old file, old default)?
4. Is the fix the smallest one? Fewer lines, no new state.

### E. Records

1. Do the release text, the card and the manifests name the same files and SHA-256 values?
2. Is each known gap written in the release text?

## Output

The review writes one table of findings: severity, claim, `file:line`, fix, and the gate or question that found it.
