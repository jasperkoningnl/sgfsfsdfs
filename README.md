# Hindsight

A prediction journal that shows how well-calibrated you really are.

Write down what you expect to happen and the chance you give it ("70% that the
contractor finishes on time"). When it's settled, mark whether it happened.
Hindsight scores you and shows whether your 70% really means 70%.

It is one static web page. There is no server, no account, no tracking and no
build step. Your journal stays in your browser.

## What you get

- **A Brier score** for everything you've settled, next to the 0.25 you'd get by
  answering 50% every time.
- **A calibration chart**: for each range of chances you gave, how often those
  predictions actually came true.
- **A confidence check** that only calls you over- or underconfident when the
  evidence is clear, not after three unlucky calls.
- **The score split into parts** (calibration error, discrimination,
  uncertainty) and a score per tag.
- **Locked predictions.** Once logged, the statement and the chance can't be
  edited. You can mark an outcome, undo that, or delete a prediction, but you
  can't quietly change what you said.
- **Export and import** of the whole journal as a JSON file.

On first visit the page shows a clearly marked example journal, so you can see
the scoring before you have data of your own. The examples are made up.

## How the scoring works

For a prediction with stated chance *f* (0 to 1) and outcome *o* (1 if it
happened, 0 if not), the Brier score is (*f* − *o*)². Your score is the average
over all settled predictions, so 0 is perfect, 0.25 is what always answering
50% earns, and 1 is certain and wrong every time. Predictions marked void are
left out.

Brier's original 1950 formula adds up the error over both outcomes, which gives
numbers twice as large (0 to 2). Hindsight uses the more common single-outcome
form.

Murphy (1973) showed that the score splits into three parts:

```
Brier = calibration error (reliability) − discrimination (resolution) + uncertainty
```

Hindsight groups predictions by the exact chance given, which makes this
identity exact; a unit test checks that it holds.

The confidence check looks at every settled prediction that leaned one way
(anything but 50%). It takes your confidence *c* in the side you favoured and
counts how often that side happened. If you were perfectly calibrated, that
count would have mean Σ*c* and variance Σ*c*(1 − *c*). Hindsight reports over- or
underconfidence only when the actual count is more than two standard deviations
away. With a few dozen predictions, expect "no clear bias" unless the pattern is
strong.

The name refers to hindsight bias: once people know an outcome, they overestimate
how predictable it was, often without noticing (Fischhoff, 1975). Locking the
prediction when it's logged is the defence against that.

### Sources

- Brier, G. W. (1950). Verification of forecasts expressed in terms of
  probability. *Monthly Weather Review*, 78(1), 1–3.
  [journals.ametsoc.org](https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml)
- Murphy, A. H. (1973). A new vector partition of the probability score.
  *Journal of Applied Meteorology*, 12(4), 595–600.
  [journals.ametsoc.org](https://journals.ametsoc.org/view/journals/apme/12/4/1520-0450_1973_012_0595_anvpot_2_0_co_2.xml)
- Fischhoff, B. (1975). Hindsight ≠ foresight: The effect of outcome knowledge
  on judgment under uncertainty. *Journal of Experimental Psychology: Human
  Perception and Performance*, 1(3), 288–299.
  [doi.org/10.1037/0096-1523.1.3.288](https://doi.org/10.1037/0096-1523.1.3.288)

## Privacy and storage

- On a normal website (such as GitHub Pages) the journal is saved in your
  browser's `localStorage`. Nothing is sent anywhere. Clearing site data deletes
  it, so export a backup now and then.
- When the page runs as a claude.ai artifact, it saves the journal in that
  artifact's database under your own private path, which nobody else can read,
  the artifact's owner included. See `site/js/storage.js`. The journal is one
  document there, capped at 256 KiB: a few hundred predictions, fewer with long
  notes. Saving past that shows an error; export a backup.
- If the stored journal can't be read (for example, it was written by a newer
  version), Hindsight keeps a copy under `hindsight.journal.v1.unreadable`
  before anything else can overwrite it.
- The fonts are served from this site, not from Google Fonts, so opening the
  page makes no third-party requests.

## Running it

Everything lives in `site/`. Serve that folder with any static file server, or
let the included GitHub Actions workflow publish it.

**Publishing with GitHub Pages:** in the repository go to *Settings → Pages* and
set *Source* to *GitHub Actions*. Every push to `main` then runs the tests and
deploys `site/` (workflow: `.github/workflows/pages.yml`). You can also start
the workflow by hand from the *Actions* tab.

## Development

There are no dependencies. Tests use Node's built-in test runner (Node 22 or
newer):

```
npm test
```

CI runs the tests on Node 22 and 24 for every push and pull request
(`.github/workflows/ci.yml`).

```
site/
  index.html        page structure
  styles.css        design tokens (light and dark) and layout
  js/scoring.js     Brier score, Murphy partition, calibration bins, confidence check
  js/journal.js     prediction record, validation, file format, merging
  js/storage.js     browser storage and claude.ai storage
  js/chart.js       calibration chart as SVG
  js/examples.js    example journal for first visit
  js/app.js         wiring and rendering
  fonts/            IBM Plex Sans and Barlow Condensed (SIL OFL 1.1)
test/               unit tests
```

### Journal file format

```json
{
  "app": "hindsight",
  "version": 1,
  "predictions": [
    {
      "id": "2f6c…",
      "statement": "The contractor finishes the bathroom within two weeks",
      "probability": 60,
      "createdAt": "2026-09-01T08:30:00.000Z",
      "resolveBy": "2026-09-15",
      "tag": "home",
      "notes": "They were late last time",
      "outcome": "no",
      "resolvedAt": "2026-09-16T19:02:11.000Z"
    }
  ]
}
```

`probability` is a whole number from 0 to 100. `outcome` is `"yes"`, `"no"`,
`"void"` or `null` while open. Importing adds predictions whose `id` isn't in
the journal yet and never overwrites existing ones, so an old backup can't undo
newer outcomes.

## Licence

Code: MIT, see [LICENSE](LICENSE). Fonts: SIL Open Font License 1.1, see
`site/fonts/OFL-*.txt`.
