# Rule packs

A rule pack is a JSON file of detection rules. Install one in **Settings → Show advanced options → Rule Packs** and SafeRedact runs its rules alongside the built-in ones on every PDF, DOCX and image. The built-in rules use the same format (`src/lib/rules/builtin-pack.ts`), and you can switch them off one by one in the same place.

See [`examples/rule-pack-example.json`](examples/rule-pack-example.json) for a complete pack.

## Domain examples

Install an example in **Settings → Show advanced options → Rule Packs → Install Rule Pack**. Every rule includes `examples` and `counterExamples` checked during installation, and each pack has a sample text file you can paste into a Word document or PDF to try it.

The six new packs (healthcare, finance, education, real estate, insurance, and IT / DevOps) use English labels, context keywords, and sample documents. Each rule sets `scripts: ["latin"]`; this filters document scripts, not languages. English field labels provide the language context. Create a separate pack for another language instead of mixing translated labels in the same pattern.

The packs detect the specific formats shown below. Adapt office-specific prefixes and number lengths to your records. Install only the packs you need; public identifiers such as NPIs, SWIFT codes, and MLS numbers may be useful to keep visible.

### Legal domain example

Install [`examples/legal-rule-pack.json`](examples/legal-rule-pack.json) for a ruleset tailored to a law office. It uses fictional office-specific formats, English and Chinese labels, and no JavaScript validators. Adapt its prefixes and formats to your practice.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Client reference | `Client ID: CL-000123` | `CL-000123` |
| Matter number | `Matter: MAT-2026-0042` | `MAT-2026-0042` |
| Contract reference | `合同编号：CTR-2026-0019` | `CTR-2026-0019` |
| Settlement amount | `Settlement amount: USD 85,000.00` | `USD 85,000.00` |

Capture groups keep field labels visible. The matter-number rule requires a nearby label such as `Matter` or `项目编号`, so the same format used as a product code does not match. The [sample text](examples/legal-domain-sample.txt) contains eight intended matches and four unrelated values that this pack should leave visible.

### Healthcare

Install [`examples/healthcare-rule-pack.json`](examples/healthcare-rule-pack.json) for patient records, prescriptions, provider NPIs, insurance member IDs, and lab accession numbers. All rules are scoped to `latin` script documents.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Patient MRN | `Patient MRN: MRN-0012345` | `MRN-0012345` |
| Prescription ID | `Rx# RX-2026-005678` | `RX-2026-005678` |
| NPI Number | `NPI: 1234567893` | `1234567893` |
| Insurance Member ID | `Member ID: BCBS012345678` | `BCBS012345678` |
| Lab Accession | `Accession No: 26L-012345` | `26L-012345` |

The NPI rule includes a sandboxed JavaScript validator that applies the [CMS NPI checksum procedure](https://www.cms.gov/regulations-and-guidance/administrative-simplification/nationalprovidentstand/downloads/npicheckdigit.pdf), including the `80840` prefix. The built-in `luhn` validator is for 13–19 digits and cannot validate a 10-digit NPI directly. This pack is marked **Contains code** and asks for confirmation during installation. Try the [sample text](examples/healthcare-domain-sample.txt): ten selected values and five unrelated references that stay visible with this pack alone.

### Finance / Banking

Install [`examples/finance-rule-pack.json`](examples/finance-rule-pack.json) for internal account numbers, wire transfer IDs, SWIFT/BIC codes, loan numbers, and trading account identifiers.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Account Reference | `Account No: 001-2345-6789` | `001-2345-6789` |
| Wire Transfer ID | `Wire Transfer ID: WT202611210001` | `WT202611210001` |
| SWIFT/BIC Code | `SWIFT: BOFAUS3N` | `BOFAUS3N` |
| Loan Number | `Loan No: LN-2026-012345` | `LN-2026-012345` |
| Trading Account | `Trading Account: TD12345678` | `TD12345678` |

Try the [sample text](examples/finance-domain-sample.txt): ten selected values and five unrelated references that stay visible with this pack alone. Account and loan formats here are fictional internal conventions, not universal banking formats.

### Education

Install [`examples/education-rule-pack.json`](examples/education-rule-pack.json) for student IDs, transcript references, financial aid IDs, GPA values, and education record numbers.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Student ID | `Student ID: 2026012345` | `2026012345` |
| Transcript Reference | `Transcript Ref: TR-2026-00123` | `TR-2026-00123` |
| Financial Aid ID | `Financial Aid ID: FA-2026-012345` | `FA-2026-012345` |
| GPA | `Student cumulative GPA: 3.85` | `3.85` |
| Education Record ID | `Education Record ID: ER2026-00123` | `ER2026-00123` |

The GPA rule requires a GPA label and nearby academic context, and accepts values from 0.00 to 4.00. Adapt it if your institution uses another scale. Try the [sample text](examples/education-domain-sample.txt): ten selected values and five unrelated references that stay visible with this pack alone.

### Real Estate

Install [`examples/real-estate-rule-pack.json`](examples/real-estate-rule-pack.json) for MLS numbers, escrow accounts, deed recording numbers, parcel/APN numbers, and purchase prices.

| Rule | Example input | Selected value |
| --- | --- | --- |
| MLS Number | `MLS# 12345678` | `12345678` |
| Escrow Number | `Escrow No: ESC-2026-01234` | `ESC-2026-01234` |
| Deed Recording | `Deed No: 2026-012345` | `2026-012345` |
| Parcel / APN | `APN: 123-456-789` | `123-456-789` |
| Purchase Price | `Purchase price: $750,000.00` | `$750,000.00` |

MLS and deed rules require field labels and nearby context. Try the [sample text](examples/real-estate-domain-sample.txt): ten selected values and five unrelated references that stay visible with this pack alone. Parcel, recording, and listing formats vary by locality; adjust them to your records.

### Insurance

Install [`examples/insurance-rule-pack.json`](examples/insurance-rule-pack.json) for policy numbers, claim references, adjuster IDs, coverage amounts, and group certificate numbers.

| Rule | Example input | Selected value |
| --- | --- | --- |
| Policy Number | `Policy No: HO-1234567` | `HO-1234567` |
| Claim Reference | `Claim No: CLM-2026-012345` | `CLM-2026-012345` |
| Adjuster ID | `Adjuster ID: ADJ-01234` | `ADJ-01234` |
| Coverage Amount | `Coverage amount: $500,000.00` | `$500,000.00` |
| Group Certificate | `Group No: GC001-012345` | `GC001-012345` |

Try the [sample text](examples/insurance-domain-sample.txt): ten selected values and five unrelated references that stay visible with this pack alone.

### IT / DevOps

Install [`examples/it-devops-rule-pack.json`](examples/it-devops-rule-pack.json) for reviewing incident reports, runbooks, and configuration audits: AWS access key IDs, labeled API keys, database connection strings, complete private key blocks, GCP service account emails, and classic GitHub PATs.

| Rule | Example input | Selected value |
| --- | --- | --- |
| AWS Access Key ID | `AKIAIOSFODNN7EXAMPLE` | `AKIAIOSFODNN7EXAMPLE` |
| API Key / Secret | `api_key: sk_live_abcdefghij1234567890` | `sk_live_abcdefghij1234567890` |
| DB Connection String | `postgresql://user:secret@db:5432/prod` | full URI |
| Private Key Block | A complete `-----BEGIN RSA PRIVATE KEY-----` … `-----END RSA PRIVATE KEY-----` block | header, body, and footer |
| GCP Service Account | `my-service@my-project.iam.gserviceaccount.com` | full email |
| GitHub PAT | `ghp_` followed by 36 letters or digits | the full token |

Try the [sample text](examples/it-devops-domain-sample.txt): eight selected values, including a complete fictional key block, and four unrelated references that stay visible with this pack alone.

API values may contain dots, slashes, and padding, and quoted JSON fields are supported. API values and connection strings are limited to 2,048 characters; longer values need manual selection. Private key blocks must have matching end markers within 16,384 characters of the body. Incomplete blocks or blocks split across PDF pages need manual selection. The GitHub rule covers classic `ghp_` tokens; add separate rules for other token formats.

---

Built-in rules run alongside any installed pack and may detect additional values. Review results, then ask your AI agent to adapt a pack using your own formats and fictional examples.

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
