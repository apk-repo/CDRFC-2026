# Cill Dara RFC — League Hub

A readable front end for the Leinster Rugby (Sportlomo) fixture feed: 1st XV and
2nd XV league tables, every fixture across league and cup competitions, and
calendar subscriptions that update themselves.

Live site: `https://apk-repo.github.io/cilldara/`
Feed health (for review): `https://apk-repo.github.io/cilldara/review.html`

## How it works

1. `scraper/scrape.py` reads the Sportlomo pages listed in `scraper/sources.json`.
2. It de-duplicates the rows, flags anything a human should look at, and writes
   `docs/data.json` plus three `.ics` calendar feeds.
3. GitHub Actions runs it on a schedule and commits the result.
4. GitHub Pages serves `docs/` as a static site. The page fetches `data.json`.

Nothing runs at request time. There is no server.

## Local run

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py --dry-run          # parse and report, write nothing
python scraper/scrape.py --debug lalor      # dump the raw line stream for one competition
python scraper/scrape.py                    # write docs/data.json and the .ics feeds
python -m http.server -d docs 8000          # then open http://localhost:8000
```

## De-duplication rule

One row per pairing per round. Where the source lists the same tie twice, the row
with the stronger evidence wins: a result, then a real date and venue, then a
placeholder. For cup competitions the pairing is order-insensitive, since a
knockout tie happens once. Nothing is deleted at source; every merge is recorded
in `data.json` under `issues` and shown on `review.html`.

## Adding a competition

Add an entry to `scraper/competitions` in `scraper/sources.json` with its
Sportlomo URL. League pages use `/league/<id>/`; knockout brackets use
`/league-diagram/<id>/`. Competitions with no URL yet render as "not drawn".
