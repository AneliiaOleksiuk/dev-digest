# Branch Coverage Gate

Flag any new or changed conditional branch — if/else, switch/case, early
return, catch block — in the diff's production code that has no
corresponding test exercising that specific branch.

For each finding:
- Cite the exact file:line of the untested branch.
- Name the condition that branch depends on.
- State which test file (if any) covers the function, and why it still
  misses this branch.

Do not flag branches already covered by an existing test in the diff or in
unchanged test files you can infer are still run. Do not flag branches in
test files themselves, generated code, or files outside the diff.