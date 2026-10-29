# Verifying a Provio attestation package

This document is the **third-party verification procedure** (T4, `docs/SYSTELIGON.md` §11.3). It is
written for someone outside the organisation that produced the artifact — a regulator, a board, a
counterparty, an acquirer, an external auditor — who has the package and nothing else, and who does
not trust the producer.

You do not need Provio. You do not need our code. You need the package file and a SHA-256. A
reference implementation that uses nothing but Node's own `node:crypto` ships in the repository at
`scripts/verify-attestation.mjs`, and you are free to re-implement every step below in any language:
the whole point is that the procedure is a document, not a binary.

---

## What a package is

A package is a single JSON file (`provio.attestation/v1`). It carries:

| Field | What it holds |
|---|---|
| `format`, `version` | The format tag and the format version. A verifier refuses a tag it does not know. |
| `generatedAt` | When the package was assembled. An input, never read from a clock. |
| `subject` | The artifact it attests: `kind` (`report_graph_root`, `engagement_certificate`, `board_pack_data_hash` or `ledger_daily_root`), an `id`, and a human `label`. |
| `roots` | The root hashes, by name. The first is the primary root. A report has a `graph_root` and a `render_hash`. |
| `versions` | The engine, template and phrase-library versions, and the rule packs (`id`, `version`) that scored the artifact. This is what makes a re-run identical. |
| `leaves` | For a report: the Merkle leaves, each `{ claimId, leafHash }`. A leaf is `sha256('00' || canonicalClaimText)`. |
| `keys` | The public keys a verifier needs: `{ keyId, algorithm: "Ed25519", publicKey }`, `publicKey` raw 32 bytes as hex. |
| `signatures` | `{ kind, subjectId, rootHash, keyId, algorithm, signature, signedAt }`. |
| `timestamps` | RFC 3161 tokens: `{ authority, genTime, tokenDer }` (DER, base64). |
| `ledgerSeq` | The ledger sequence the root was anchored at, or `null`. |
| `packageRoot` | The root over everything above. This is the value a change invalidates. |
| `instructions` | This procedure, as data, so the artifact is self-describing. |

**Nothing in a package is tenant content.** It holds only hashes, signatures, public keys, timestamp
tokens, ids and version strings. The claim text behind a leaf is not in the package and cannot be
recovered from a leaf hash.

## What a package proves — and what it does not

A package that passes every step below proves three things:

1. **Internal consistency.** The package has not been altered since it was sealed; a change to any
   field changes the `packageRoot`.
2. **The claim set is the one that was scored.** The leaves fold to the recorded graph root; a leaf
   cannot be added, removed or changed without breaking the fold.
3. **Provenance and time.** The roots were signed with the named keys and stamped by the named
   timestamp authorities.

It does **not** prove the claims behind the leaves were true. The engine proves structure and
arithmetic; a human decides what the shape means. This is tamper-**evidence**: it proves a change
happened and preserves the before and after hashes. It does not prevent a change.

---

## The procedure

### Step 0 — Read the package

Parse the JSON. Confirm `format` is `provio.attestation/v1`. Reject anything else: a verifier must not
guess at a format it does not know.

### Step 1 — Re-derive the package root

1. Take the parsed object and **remove the `packageRoot` field**.
2. Serialise it **canonically**: every object's keys sorted by Unicode code point, no insignificant
   whitespace, `null`/`undefined` rendered as `null`, numbers as their shortest form, strings
   JSON-escaped.
3. Take the **SHA-256 of the UTF-8 bytes**, lowercase hex.

The result must equal the `packageRoot` field. If it does not, the package was altered after sealing
and **verification fails here** — nothing below this line matters.

```
packageRoot == sha256_hex( canonical_json( package_without_packageRoot ) )
```

The canonical serialisation is the one subtlety. A canonical form sorts keys and emits no spaces, so
`{"b":1,"a":2}` and `{"a":2,"b":1}` produce the same bytes and the same hash. The reference
implementation's `canonical()` is ~15 lines and is reproduced verbatim in
`scripts/verify-attestation.mjs`.

### Step 2 — Re-derive the Merkle root

Skip this step when `leaves` is empty (a certificate or a board pack has a single root, not a tree).

For each leaf in order, `leafHash` is given. Fold them pairwise:

- An **internal node** is `sha256_hex('01' + left + right)`, where `left` and `right` are the hex
  strings of the two child hashes, concatenated, then hashed.
- When a level has an **odd** number of nodes, the last node is **promoted unchanged** to the next
  level. It is **not** duplicated. Duplicating would let two different leaf sets share a root.
- Repeat until one hash remains. That is the Merkle root.

The result must equal the `graph_root` entry in `roots`. The leaf domain prefix is `'00'` and the
internal-node prefix is `'01'`, so a leaf hash can never be mistaken for an internal node.

### Step 3 — Verify every signature

For each entry in `signatures`:

1. Rebuild the **canonical signing input**: the object
   `{"key_id","kind","root_hash","signed_at","subject_id"}` with those five keys, serialised with no
   whitespace, in that (sorted) key order. The `key_id` is the signature's `keyId`, `root_hash` is its
   `rootHash`, and so on.
2. Find the public key in `keys` whose `keyId` matches. If there is none, the signature **cannot be
   checked** — report that, do not pass it.
3. Verify the **Ed25519** signature (hex in `signature`) over the UTF-8 bytes of the canonical signing
   input, against the raw public key.

Every signature must verify. The key is **raw 32 bytes**, not a PEM. To use a library that wants a
SubjectPublicKeyInfo, wrap the 32 bytes in the fixed 12-byte Ed25519 prefix
`302a300506032b6570032100` (a DER `SEQUENCE`); `scripts/verify-attestation.mjs` does exactly this in
`publicKeyFromRawHex()`.

### Step 4 — Check the timestamps

Each token in `timestamps` is an **RFC 3161 TimeStampToken** (DER, base64). Check that:

- its message imprint equals the root hash it covers;
- its `genTime` falls inside the signing certificate's validity window;
- the certificate chain validates against a **trust anchor you hold**, not one the package supplies.

The last point is the one that matters: the trust anchor is **yours**, never the producer's. This is
why the reference verifier reports timestamp *presence* and leaves the anchor decision to you. A hash
is the only tenant-derived value a timestamp covers, and a hash is not content.

### Step 5 — Compare the roots to what you were told to expect

The `graph_root` (the primary root) must equal the root the issuing organisation gave you through a
channel you trust — a letter, a signed statement, a published register. This is the step that turns
internal consistency into a statement about a *specific* artifact.

The reference verifier takes `--expect-root <hex64>` for this. Without it, steps 1-4 prove the package
is self-consistent and signed; with it, they prove the package is the one you were told about.

---

## The reference implementation

```bash
node scripts/verify-attestation.mjs attestation-report_graph_root-<id>.json
node scripts/verify-attestation.mjs package.json --expect-root <hex64>
```

It prints each step and its result, so the run is itself the evidence. Exit code `0` means every check
passed; `1` means a check failed and the reasons are printed; `2` is a usage error.

The same procedure is implemented inside the product in `src/lib/attestation.ts`
(`verifyAttestationPackage`), on the Attestation screen (OA-30). A test
(`src/lib/attestation.standalone.test.ts`) builds a package with the in-product code and requires the
standalone verifier to reach the same verdict, so a divergence between the two fails the build. The
two implementations being the same procedure is the property that makes this attestation rather than
assertion.

## Worked example

A minimal package with no leaves (a certificate), one signature, no timestamps:

```json
{
  "format": "provio.attestation/v1",
  "version": 1,
  "generatedAt": "2026-10-27T09:00:00Z",
  "subject": { "kind": "engagement_certificate", "id": "…", "label": "Certificate v3" },
  "roots": [{ "name": "cert_hash", "hash": "<64 hex>" }],
  "versions": { "engine": "", "template": "", "phraseLibrary": "", "rulePacks": [] },
  "leaves": [],
  "keys": [{ "keyId": "key-1", "algorithm": "Ed25519", "publicKey": "<64 hex>" }],
  "signatures": [{ "kind": "engagement_certificate", "subjectId": "…", "rootHash": "<64 hex>",
                   "keyId": "key-1", "algorithm": "Ed25519", "signature": "<128 hex>",
                   "signedAt": "2026-10-27T00:00:00Z" }],
  "timestamps": [],
  "ledgerSeq": null,
  "packageRoot": "<64 hex>",
  "instructions": [ "…" ]
}
```

To verify: canonicalise the object without `packageRoot`, SHA-256 it, compare to `packageRoot`; rebuild
the signing input for the one signature, verify it against `keys[0].publicKey`; compare `roots[0].hash`
to the root you were given.

---

## Why this is different

Most assurance artifacts ask you to trust the producer: a PDF with a logo, a dashboard with a green
tick. This asks you to trust arithmetic. You re-derive the root yourself, from the artifact, with your
own tooling, and either it matches or it does not. The producer cannot help you pass and cannot stop
you checking. That is the whole product, and it is why the procedure is published rather than
obfuscated.
