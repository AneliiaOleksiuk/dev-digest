# response-schema

Flag any change to the *shape* of a response — not just field renames, but type changes, new required-ness, or nesting changes — even when the route itself is untouched. Cite the exact `file:line`.

## What counts
- A field's type changes (`string` → `number`, `object` → `array`)
- A field that was always present becomes conditionally present (or vice versa)
- A flat field gets nested under a new object, or vice versa
- An array's item shape changes

## What does NOT count
- Adding a new field alongside existing ones
- Widening a type (e.g. `string` → `string | null` when the field could already be missing on some rows)

## Bad (silent shape change)
```ts
// before: { total: number }
// after:
return { total: { amount: number, currency: string } }; // flat -> nested, breaks every existing consumer
```

## Good (versioned/additive shape change)
```ts
return {
  total: amount, // unchanged, still a plain number
  totalDetails: { amount, currency }, // new field carries the richer shape
};
```
