# Rule packs

A rule pack is a JSON file of detection rules. Install one in **Settings → Show advanced options → Rule Packs** and SafeRedact runs its rules alongside the built-in ones on every PDF, DOCX and image. The built-in rules use the same format (`src/lib/rules/builtin-pack.ts`), and you can switch them off one by one in the same place.

See [`examples/rule-pack-example.json`](examples/rule-pack-example.json) for a complete pack.

## Legal domain example

Install [`examples/legal-rule-pack.json`](examples/legal-rule-pack.json) for an example of a ruleset tailored to a law office. It uses fictional office-specific formats, English and Chinese labels, and no JavaScript validators. Adapt its prefixes and formats to your practice.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Client reference | `Client ID: CL-000123` | `CL-000123` |
| Matter number | `Matter: MAT-2026-0042` | `MAT-2026-0042` |
| Contract reference | `合同编号：CTR-2026-0019` | `CTR-2026-0019` |
| Settlement amount | `Settlement amount: USD 85,000.00` | `USD 85,000.00` |

Capture groups keep field labels visible. The matter-number rule requires a nearby label such as `Matter` or `项目编号`, so the same format used as a product code does not match. Each rule includes examples and counter-examples checked during installation.

The [sample text](examples/legal-domain-sample.txt) contains eight intended matches and four unrelated values that this pack should leave visible. Paste it into a Word document or a text-based PDF to try it in SafeRedact. Built-in rules run alongside the pack and may detect additional values. Review results, then ask your AI agent to adapt the pack using your own formats and fictional examples.

## Pack

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Letters, digits, `.`, `_` or `-`. Installing a pack with the same id updates it and keeps the rules you switched off. |
| `name` | yes | Shown in Settings. |
| `version`, `description`, `author` | no | Shown in Settings. |
| `rules` | yes | One or more rules (below). |
| `validators` | no | JavaScript validators, by name (see [Validators with code](#validators-with-code)). |

## Rule

| Field | Default | Description |
| --- | --- | --- |
| `id` | required | Unique within the pack. |
| `name` | required | Shown on the entities the rule detects. |
| `pattern` | required | A JavaScript regular expression, as a JSON string (so `\d` is written `"\\d"`). |
| `flags` | `""` | Any of `i`, `m`, `s`, `u`. Matching is always global. |
| `entityType` | `CUSTOM` | One of `PERSON`, `ORG`, `LOC`, `DATE`, `ID`, `CREDIT_CARD`, `PHONE`, `EMAIL`, `CUSTOM`. Decides the colour, the filter and the Settings checkbox. |
| `confidence` | `0.8` | From 0 to 1. Detections below the threshold for the chosen aggressiveness are dropped (balanced keeps 0.7 and up). |
| `group` | whole match | A capture group number or name. Only that group is detected and redacted, so `"Badge: (?<number>\\d{5})"` with `"group": "number"` redacts the number but not the label. |
| `validator` | none | A built-in validator, or a name from the pack's `validators`. Matches it rejects are dropped. |
| `contextKeywords` | none | Words that raise confidence when they appear near the match. Latin keywords must be whole words, and CJK keywords can appear anywhere. |
| `contextWindow` | `10` | How many characters on each side of the match to search for keywords. |
| `confidenceBoost` | `1.2` | What confidence is multiplied by when a context keyword is near (capped at 1). |
| `requireContext` | `false` | Drop matches without a context keyword nearby. |
| `excludeKeywords` | none | Drop matches with any of these words nearby. |
| `scripts` | all | Only run on documents in these scripts: `latin`, `chinese`, `japanese`, `korean`, `cjk`, `arabic`, `hebrew`, `cyrillic`, `devanagari`, `thai`. |
| `examples` | none | Text the rule must detect. |
| `counterExamples` | none | Text the rule must not detect. |

When you install a pack, every rule runs against its `examples` and `counterExamples`, and a pack that gets any of them wrong isn't installed. Add a few of each so a typo in a pattern shows up straight away.

### Built-in validators

| Name | Checks |
| --- | --- |
| `luhn` | Luhn checksum (card numbers, many account numbers) |
| `credit-card` | Luhn, also accepting a 16-digit card followed by a CVV |
| `cn-id` | Chinese national ID: birth date and ISO 7064 check digit |
| `cn-mobile` | Chinese mobile number prefixes |
| `us-ssn` | US Social Security Number area, group and serial |
| `us-phone` | US area code and exchange |
| `intl-phone` | 8 to 15 digits |
| `bitcoin` | Bitcoin address checksum |
| `cn-date` | Chinese date (2024年1月15日, 2024年1月, 1月15日) is a real date, also in full-width digits |
| `compact-date` | YYYYMMDD is a real date from 1900 to 2099 |
| `short-year-date` | DD/MM/YY or MM/DD/YY is a real date either way round |

## Validators with code

For checks a regex can't express, a pack can ship JavaScript. Each entry in `validators` is the source of a function:

```json
"validators": {
  "employeeIdChecksum": "(match, ctx) => Number(match.at(-1)) === [...match.slice(4, 9)].reduce((s, d) => s + Number(d), 0) % 10"
}
```

The function receives:

- `match`: the detected text (the capture group, if the rule sets `group`)
- `ctx.groups`: every capture group of the match
- `ctx.before`, `ctx.after`: up to `contextWindow` characters on each side

It returns `true` to keep the match, `false` to drop it, or a number from 0 to 1 to keep it with that confidence. If a validator throws, the match is kept so you can review it.

Validators can see document text, so they run in a sandbox:

- Each pack gets its own worker. Before the pack's code loads, every global except plain JavaScript built-ins (`Math`, `JSON`, `RegExp`, `Intl`, typed arrays…) is removed. That takes out network access (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`), storage, timers, `eval` and the `Function` constructor.
- `import` is rejected, so code can't load other code.
- Validators only receive the match and the text around it, never the whole document.
- A batch that runs longer than 5 seconds stops the worker.

Even so, only install packs with code from people you trust. SafeRedact asks before installing one, and marks it **Contains code** in Settings.

## Backups

Export Settings includes your rule packs and which rules are switched off. Import Settings checks each pack the same way an install does.
