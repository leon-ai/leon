# Wikipedia Package

The Wikipedia package allows your personal assistant to gather pieces of information from Wikipedia.

#### Requirements
- wikipedia

#### Usage

1. Duplicate the file `packages/wikipedia/config/config.sample.json` and rename it `config.json`.
2. Set your language and other settings.
3. This package uses wikipedia. To install it: from inside leon directory `cd bridges/python`
4. `pipenv install wikipedia`
5. Done!

```
(en-US)
- "Search on Wikipedia GitHub"

```

#### Options
- `lang`: Choose your language. Default: `en`
- `sentences`: Number of sentences to report. No greater than 10.

#### Links

- [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page)
- [Wikipedia GitHub](https://github.com/goldsmith/Wikipedia)
- [Wikipedia Docs](https://wikipedia.readthedocs.io/en/latest/)
