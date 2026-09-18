# TPS Health 0.47.4

Recorded nutrients now appear in macro views without configuring GCM property menus or adding Health goals. This patch fixes incomplete display of nutrition values Health already supports.

- Inline Macros includes recorded fiber, sugar, sugar alcohol, alcohol and sodium alongside vitamins, minerals and supplements such as creatine.
- Macros Bases default **Show nutrients** to **Recorded nutrients**, adding known nutrient amounts from the filtered food entries. **Selected properties only** keeps the previous explicit visibility behavior. Alcohol is available for selection without a goal.
- Expand **Nutrients** for amounts and contributing foods. Existing collapsed/expanded/hidden presentation still applies. Unconfigured nutrients have no invented targets; stored precision and one-decimal macro display are preserved.
- No GCM menu definitions, Health goals, existing Base files or stored nutrient values are migrated or changed. An explicitly selected Base option persists in that Base only.

Atomic note logging still uses GCM’s native-record storage bridge; it does not require nutrient fields configured in GCM menus. Extended unknown values stay absent and known zeroes remain known. Historical core totals cannot distinguish unknown from zero, so unconfigured core rows appear automatically only for positive totals. Missing provider/label amounts are never inferred. Minimum Obsidian: **1.12.0**.

## Validation

- Full declared suite: **435 passed, zero failed, one skipped** (optional live USDA test without a test credential).
- Focused tests cover native record persistence/indexing/totals with no menu definitions or goals, all requested nutrient categories, automatic Base rows, explicit property-only mode, custom targets, known zeroes and unknown values.
- TypeScript, separate final production build and test-vault deployment passed. Reloaded only TPS Health in the named **Obsidian Plugin Test Vault**.
- Real macro renderer showed fiber 3.5 g, alcohol 14 g, vitamin C 90 mg, magnesium 125 mg, creatine 2.5 g and iron 0 mg with no selected properties/goals. Creatine expanded to its contributing food. A 388 px container had no horizontal overflow.
- In-memory UI fixtures removed. No notes, settings changes or outbound provider calls were created. Health runtime data.json remained byte-identical. Final rebuilt artifacts matched the tested runtime exactly.

Tested in the test vault and ready for the user's BRAT pull. No production installation or physical iOS test is claimed.

## SHA-256

| Artifact | SHA-256 |
| --- | --- |
| main.js | `842c5fcec9a4aac8d565261ec3f9df90c8ecdb69c7da6aa3629d2f4b51f0c4ac` |
| manifest.json | `ed240b7c5493f0be364cb38893808aeeb1ab227fbae2534e9566dd39dfc68b92` |
| styles.css | `2ea5f468771641df1968b53c7157f7f047cc48f2f236c826a18e11e14657d4b8` |
