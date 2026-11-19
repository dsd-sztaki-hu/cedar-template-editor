# Upgrading the ARP Dataverse templates to new Dataverse versions

This guide covers upgrading the ARP Dataverse templates in CEDAR (`/Public/Dataverse`) from Dataverse 6.9 to 6.10, 6.11 and 6.12.1, and checking the result.

The upgrade itself runs in the CEDAR UI ("ARP Upgrade to Dataverse versions"). The two scripts here make it safe:

- **Dry-run:** runs the same upgrade code on a copy of the live folder, *before* anything changes in CEDAR, and shows what the result will be.
- **Post-check:** compares live CEDAR with the dry-run *after* the UI upgrade, to confirm it produced exactly that.

Both scripts only read from CEDAR. They never create, change, publish or delete anything there.

## The workflow at a glance

| Step | Where | What it does | Changes live CEDAR? |
|---|---|---|---|
| 1. Dry-run | terminal | Simulates the whole upgrade and writes the expected result to a work folder | No |
| 2. Review | work folder | You check the report and the generated templates | No |
| 3. Upgrade to Dataverse versions | CEDAR UI | Publishes the current drafts as 6.9.0 (with only the ISO 639-2 languages in citation), then creates 6.10.0, 6.11.0 and 6.12.1, archiving each older version | **Yes** |
| 4. Post-check | terminal | Confirms live CEDAR matches the dry-run | No |

Do not continue to the next step if a step reports a failure.

## Before you start

- **Node 18 or newer.** Check with `node --version`. The frontend build may use an older Node, so switch first, e.g. `nvm use 22`. With an older Node the scripts stop with `Node 18 or newer is required`.
- **The settings for live CEDAR in `tests/node/.env`.** Copy the example and fill in the API key of the CEDAR Admin user:

  ```sh
  cp tests/node/.env.example tests/node/.env
  # edit tests/node/.env: replace <...> in CEDAR_API_KEY with the real key
  ```

  `.env.example` explains every setting. Fill in `CEDAR_DOMAIN` too: the base domain of the live CEDAR (for the web app `https://cedar.example.org` it is `example.org`). The other defaults are the live values: folder `/Public/Dataverse`, from 6.9.0 to 6.10, 6.11 and 6.12.1, and the live ARP converter and check.
  - `tests/node/.env` is git-ignored. Never commit it, and never put the key into `.env.example`.
  - The key is only sent to CEDAR. It is never printed or saved to the work folder.
  - A variable set in the shell (`export CEDAR_API_KEY=...`) or a command-line option (`--domain ...`) wins over the file.
- **Log in to the CEDAR UI as CEDAR Admin for step 3.** The upgrade puts the archived versions into the `Versions` folder in the home folder of whoever runs it, and the dry-run and post-check expect CEDAR Admin's home.
- **Internet access** to:
  - `resource.<CEDAR_DOMAIN>` and `user.<CEDAR_DOMAIN>` (CEDAR)
  - `repo.researchdata.hu` (the ARP converter and template check)
  - GitHub (the official Dataverse metadata blocks)

All commands below are run in the `cedar-template-editor` folder.

---

## Step 1: Dry-run

```sh
npm run arp-upgrade:dry-run
```

This takes a few minutes. It works through these steps:

1. **Reads `/Public/Dataverse`** from CEDAR Admin's home: every template, element and field, with GET requests only. Everything is held in memory from here on.
2. **Checks the starting point:**
   - Every resource is either a draft or published as 6.9.0. A mix is refused.
   - Every template has a `schema:identifier`, which is its Dataverse block name, for example `citation`.
   - `Versions/Public/Dataverse` does not yet contain 6.9.0, 6.10.0 or 6.11.0.
3. **Downloads the official metadata blocks** of Dataverse v6.9, v6.10, v6.11 and v6.12.1 from GitHub.
4. **Runs the UI's upgrade code, unchanged**, on the in-memory copy. The folder holds drafts, which is the case today, so it first removes every citation language that is not ISO 639-2 (see [The citation languages](#the-citation-languages)) and publishes everything as 6.9.0. Then, for each of 6.10.0, 6.11.0 and 6.12.1:
   - archives the current version to `Versions/Public/Dataverse/<version>` and makes draft copies,
   - merges the official changes into the drafts,
   - checks the changed templates with the live ARP template check,
   - publishes everything as the new version.
5. **Checks the result.** For every template:
   - every ARP field is still there,
   - every field the official blocks added is there,
   - every value ARP changed itself keeps the ARP value,
   - every value ARP did not touch gets the new official value,
   - value lists keep all ARP values and gain the new official ones,
   - the citation `language` field has exactly the ISO 639-2 languages of the official block, in every version (6.9.0 too),
   - field order and term URIs are correct,
   - each new field is embedded in its template or element, like ARP's other fields; the upgrade makes no `fields` folder and no standalone field resources,
   - each new element has one standalone resource in the template's `elements/` folder.

   It also checks that the folder is published as 6.12.1, that 6.9.0, 6.10.0 and 6.11.0 are archived under `Versions`, and that the archived 6.9.0 is the drafts as they were, apart from the removed languages.
6. **Writes everything** to a new work folder.

### Reading the output

A successful run ends like this:

```
The folder holds drafts: the upgrade publishes them as 6.9.0 first, then archives 6.9.0
Preview 6.9.0: citation 1 changes, 0 ARP values kept
...
  citation: 84 ARP fields, 0 new official fields
  geospatial: 11 ARP fields, 27 new official fields
  ...
Restricted values: citation language 6.9.0: 422, citation language 6.10.0: 422, citation language 6.11.0: 422, citation language 6.12.1: 422
CEDAR requests: {"GET":216}
All checks passed
Work folder: tests/node/work/2026-11-19T10-15-00
```

- **`Preview 6.9.0`** is the language change on the drafts before they are published (`preview.json` has the numbers: 7,516 removed, 422 kept).
- **`Restricted values`** gives the number of citation languages in each version: 422 everywhere.
- **The block lines** give, per template, the number of fields it had before and the number of fields the official blocks add. With the current blocks only geospatial gains fields (27).
- **`CEDAR requests`** shows that only GET requests were sent.
- **Every failed check is printed as a `FAIL` line**, naming the block, the field and the rule that broke. For example:

  ```
  FAIL citation title_hu skos:prefLabel keeps the ARP value
  ```

  The run then ends with `FAILED: <n> checks` and exit code 1.

### The work folder

`tests/node/work/<timestamp>/` (git-ignored) contains:

| Path | Contents |
|---|---|
| `report.txt` | Everything the run printed. **Start here.** |
| `preview.json` | What the upgrade changes in each version and block: added fields and values, changed values, values kept because ARP changed them, and official changes that are never applied automatically |
| `source/` | `/Public/Dataverse` exactly as it was read from CEDAR |
| `official/<tag>/` | The official TSV files the run used |
| `results/6.9.0/`, `6.10.0/`, `6.11.0/`, `6.12.1/` | The resources of each version, one folder per template, with the standalone elements under `elements/`. Fields are embedded in their template or element. |
| `expected-home/` | The whole expected home folder after the upgrade: `Public/Dataverse/` (6.12.1) and `Versions/Public/Dataverse/<version>/`. The post-check compares against this. |
| `layout.json` | Every resource of `expected-home/` with its path, type, version, status, identifier and the resource it was copied from |

Keep this work folder. Step 4 needs it.

---

## Step 2: Review the dry-run

1. Open `report.txt`. It should end with `All checks passed`.
2. Read the `Preview` lines, or `preview.json` for details. Today they say:
   - **6.9.0:** citation keeps only the ISO 639-2 languages (7,516 removed, 422 kept) before the drafts are published.
   - **6.10.0:** no changes. There is no template for the new `review` block, and none is created.
   - **6.11.0:** geospatial gains the new official fields. There is no template for the rubric block.
   - **6.12.1:** citation's `contributorType` gains the value "Translator".
3. Look at `reportOnly` in `preview.json`. These are official changes the upgrade never applies, such as removed fields or changed input types. Decide by hand whether they matter.
4. Optionally, open some templates in `results/6.12.1/` and compare them with `source/`.

---

## Step 3: Run the upgrade (CEDAR UI)

1. Log in to CEDAR as **CEDAR Admin**, open the menu of the `Dataverse` folder and choose **ARP Upgrade to Dataverse versions**.
2. Enter:
   - **Current Dataverse version of the folder:** `6.9.0`
   - **Target Dataverse versions, oldest first:** `6.10`, `6.11`, `6.12.1`
3. Click **Preview**. It should show the same changes as `preview.json` from step 1, starting with 6.9.0: *language: only the ISO 639-2 values are kept, 7516 removed, 422 left*.
4. Click **Run** and wait until all four versions are finished.

No **ARP Publish All** is needed before this. How the run starts depends on the folder:

| The folder holds | The run |
|---|---|
| Drafts, and `Versions/Public/Dataverse/<current version>` does not exist (live today) | Keeps only the ISO 639-2 citation languages, publishes the drafts as the current version, then archives it and makes each target version |
| Only resources published as the current version | Archives it and makes each target version |
| Drafts, and `Versions/Public/Dataverse/<current version>` exists | An earlier run stopped after archiving: it continues, without publishing or archiving the current version again |

Afterwards:

- `Public/Dataverse` holds the 6.12.1 templates, published.
- `Versions/Public/Dataverse/6.9.0`, `6.10.0` and `6.11.0` (in CEDAR Admin's home) hold the archived versions.

If the run stops part-way, the dialog says which versions are complete and which version to enter as the current version. Fix the problem, then open the dialog again with that version.

### The citation languages

Since Dataverse 6.x the official citation block lists about 7,900 languages (all of ISO 639-3) for `language`. ARP only offers the ISO 639-2 languages: the 421 official values whose identifier is an ISO 639-2 code, plus "Not applicable", which makes 422 values. The other 66 ISO 639-2 codes are language groups (for example "Bantu languages") and have no value in Dataverse.

- **The first version (6.9.0)**: before publishing the drafts, the upgrade removes the other languages from them, including old ARP labels that are no longer in the official list.
- **The later versions**: the upgrade ignores the official values outside ISO 639-2 when it compares two Dataverse versions, so it never adds them. It also removes them from every version it makes, in case they are still there.
- **The list of codes** is `ISO_639_2` in `arp-dataverse-upgrade.service.js`, from the [Library of Congress](https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt). `RESTRICTED_VOCABULARIES` there says which field of which block is restricted.

Values that datasets in ARP Dataverse already use stay valid there, because loading a metadata block into Dataverse does not delete values.

---

## Step 4: Post-check

Use the work folder from step 1:

```sh
npm run arp-upgrade:post-check -- --against tests/node/work/<timestamp>
```

It reads the live `Public/Dataverse` and `Versions/Public/Dataverse/*` and compares them with the dry-run's `expected-home/`. Resources are matched by folder, type and name, because CEDAR gives them different ids than the dry-run.

For every resource it checks:

- it exists, and nothing extra is there,
- its content is the same, ignoring ids, timestamps and who made it, but comparing version, status and `schema:identifier`,
- `pav:derivedFrom` points to the right archived resource of the previous version,
- every embedded field or element points to the right resource.

A successful check ends with:

```
Compared 802 expected resources in 92 folders with 802 found
CEDAR requests: {"GET":904}
Live CEDAR matches the dry-run
```

Each difference is printed as a `DIFF` line, for example:

```
DIFF Public/Dataverse/Journal Metadata/elements/element:journalVolumeIssue schema:description: expected "Indicates the volume...", found "..."
DIFF missing Public/Dataverse/Geospatial Metadata/elements/element:geographicDistribution
```

The output is also saved to `post-check.txt` in the work folder.

If CEDAR itself adds or changes a property on every save that the dry-run cannot know about, it shows up as the same `DIFF` on many resources. If you are sure the property doesn't matter, add it to `IGNORED_KEYS` in `arp-upgrade-post-check.js`.

---

## Rehearse the whole workflow locally first

You can do steps 1 to 4 on your local CEDAR and Dataverse, on a copy of the live templates, before doing them on live.

**You need:**
- the local CEDAR (`https://*.arp.orgx`)
- the local ARP Dataverse (`http://localhost:8080`), which is what the local CEDAR UI uses for converting and checking templates
- the live API key, only for step L1

Every command below is run in the `cedar-template-editor` folder.

### L1. Take a copy of live (read-only)

Run the normal dry-run against live:

```sh
CEDAR_API_KEY=<live key> npm run arp-upgrade:dry-run
```

Its work folder contains `source/`, the live `/Public/Dataverse` exactly as it is now. This dry-run doubles as step 1 for the real upgrade later.

### L2. Put the copy into the local CEDAR

The copy script changes only a local CEDAR: it refuses any domain that doesn't end in `.orgx`. First see what it would do:

```sh
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run arp-upgrade:local-copy -- --source tests/node/work/<live timestamp>/source
```

Then do it:

```sh
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run arp-upgrade:local-copy -- --source tests/node/work/<live timestamp>/source --yes
```

This does four things in the local CEDAR:
1. deletes `/Public/Dataverse`,
2. deletes `/Versions/Public/Dataverse` (archives of earlier upgrades),
3. uploads the live copy as drafts, the same state live is in,
4. reads the copy back, compares it with the source, and ends with `The local /Public/Dataverse is now a draft copy of the source`.

It uses the local development API key unless `LOCAL_CEDAR_API_KEY` or `--api-key` is set. It never reads `tests/node/.env` or `CEDAR_API_KEY`, so the live key is never sent to the local CEDAR. `NODE_TLS_REJECT_UNAUTHORIZED=0` is needed because the local CEDAR's certificate is self-signed.

### L3. Run steps 1 to 4 against the local CEDAR

Set these for every local command. Shell variables and `--domain` win over the live values in `tests/node/.env`:

```sh
export NODE_TLS_REJECT_UNAUTHORIZED=0
export CEDAR_API_KEY=0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff
export ARP_CONVERT_URL=http://localhost:8080/api/arp/convertTsvToCedarTemplate
export ARP_CHECK_URL=http://localhost:8080/api/arp/checkCedarTemplate
```

1. **Dry-run:**

   ```sh
   npm run arp-upgrade:dry-run -- --domain arp.orgx --work-dir tests/node/work/local-trial
   ```

2. **Review** `tests/node/work/local-trial/report.txt`.
3. **In the local CEDAR UI**, as CEDAR Admin: run **ARP Upgrade to Dataverse versions** on `Public/Dataverse` with current version `6.9.0` and targets `6.10`, `6.11`, `6.12.1`.
4. **Post-check:**

   ```sh
   npm run arp-upgrade:post-check -- --domain arp.orgx --against tests/node/work/local-trial
   ```

If the post-check ends with `Live CEDAR matches the dry-run`, the UI did exactly what the dry-run predicted. Any `DIFF` lines show where real CEDAR behaves differently from the simulation, and it is much better to find those locally.

To rehearse again, repeat L2: it resets the local folder and its archives.

## Options

These options work for the dry-run and the post-check:

| Option / variable | Default | Meaning |
|---|---|---|
| `--folder` / `ARP_UPGRADE_FOLDER` | `/Public/Dataverse` | Folder path below the home folder, or a folder `@id` |
| `--domain` / `CEDAR_DOMAIN` | – (required) | CEDAR is `https://resource.<domain>` |
| `--home-user` / `CEDAR_HOME_USER` | `CEDAR Admin` | Whose home folder holds the folder and `Versions` |
| `--api-key` / `CEDAR_API_KEY` | – (required) | The CEDAR API key |
| `--source-dir` | – | Read a folder saved on disk instead of CEDAR. Use it with a home folder layout, like `expected-home/`. |

The dry-run also accepts:

| Option / variable | Default | Meaning |
|---|---|---|
| `--from` / `ARP_UPGRADE_FROM` | `6.9.0` | The version the folder is, or will be published as |
| `--targets` / `ARP_UPGRADE_TARGETS` | `6.10,6.11,6.12.1` | The versions to upgrade to |
| `--work-dir` | `tests/node/work/<timestamp>` | Where to write the results |
| `--official-dir` | – | Read `<dir>/<tag>/*.tsv` instead of downloading from GitHub |

The post-check also takes `--against <work folder>`, which is required.

Pass options after `--`, for example:

```sh
npm run arp-upgrade:dry-run -- --targets 6.10,6.11
```

Environment variables:

| Variable | Default |
|---|---|
| `ARP_CONVERT_URL` | `https://repo.researchdata.hu/api/arp/convertTsvToCedarTemplate` |
| `ARP_CHECK_URL` | `https://repo.researchdata.hu/api/arp/checkCedarTemplate` |

---

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| `Set CEDAR_API_KEY ...` | The API key is missing. Export it, or pass `--api-key`. |
| `CEDAR returned 401 ...` | The API key is wrong. |
| `No CEDAR user named "CEDAR Admin"` | Use `--home-user` with the right user name. |
| `FAIL /Public/Dataverse does not exist` | Wrong `--folder`, or the folder is not in that user's home. |
| `FAIL every resource is a draft, or published as 6.9.0; found ...` | The folder mixes drafts and published resources, or is published at another version. Make it all drafts, or all published as 6.9.0. |
| `FAIL /Versions/Public/Dataverse/6.9.0 does not exist yet` | An earlier upgrade already archived here. The new archive would mix with it, so clean up `Versions` first. |
| `FAIL template ... has a schema:identifier` | That template has no block name, so the upgrade cannot match it to an official block. |
| `FAIL ... citation language has the 422 allowed values, found 7938` | The language list was not shortened, e.g. the folder was published with ARP Publish All before the upgrade. The upgrade still shortens 6.10.0 and later. |
| `FAIL the upgrade stopped: ...validation...` | The ARP template check rejected an upgraded template. The `Template check:` line shows why. |
| `The converter is not reachable` / `GitHub returned 403` | Network problem, or the GitHub rate limit (60 requests per hour without a login). Wait, or use `--official-dir`. |
| Certificate errors | Run with `NODE_TLS_REJECT_UNAUTHORIZED=0`. |

---

## The fixture test

`npm run test:arp-upgrade` runs the same upgrade and checks on checked-in data:

- **ARP side:** `fixtures/arp-upgrade/arp/6.9`, the TSV export of the live ARP blocks. Each TSV is converted to a template with the local ARP converter, so the local ARP Dataverse must be running.
- **Official side:** `fixtures/arp-upgrade/official`, copies of the official IQSS blocks.

Like live, the ARP templates start as drafts, and the upgrade publishes them as 6.9.0 first. A second run checks that a stopped run continues without publishing 6.9.0 again. It writes its results to `fixtures/arp-upgrade/results`. Run it after changing the upgrade code. See `fixtures/arp-upgrade/SOURCE.txt` for where the fixtures come from.

## Files

| File | Purpose |
|---|---|
| `arp-upgrade-dry-run.js` | Step 1 |
| `arp-upgrade-post-check.js` | Step 4 |
| `arp-upgrade-local-copy.js` | Rehearsal: puts a copy of live into a local CEDAR (refuses any domain that isn't `*.orgx`) |
| `arp-dataverse-upgrade.test.js` | The fixture test |
| `arp-upgrade-store.js` | The in-memory CEDAR the upgrade runs on, the official block loading and the converter |
| `arp-upgrade-checks.js` | The checks shared by the dry-run and the fixture test |
| `cedar-read.js` | Read-only access to CEDAR (GET only), or to a saved folder |
| `load-service.js` | Loads the UI's AngularJS service files under Node |

The upgrade code itself is in `app/scripts/service/arp-dataverse-upgrade.service.js` and `app/scripts/service/arp-mdb-merge.service.js`. The scripts run these files unchanged.
