# Knowledge Package

The Knowledge package aims at answering general questions.

#### Usage

1. Set up and account at [Wolfram Alpha API](http://developer.wolframalpha.com) and create an `app_id`.
2. Duplicate the file `packages/knowledge/config/config.sample.json` and rename it `config.json`.
3. Set your language and other settings.
4. This package needs a few libraries to work properly. To install it, from inside leon directory, `cd bridges/python`
5. `pipenv install requests wikipedia wolframalpha`
6. Done!


### Wikipedia

```
(en-US)
- "Search on Wikipedia GitHub"
```

#### Requirements
- requests
- wikipedia

#### Options

- `lang`: Choose your language. Default: `en`
- `sentences`: Number of sentences to report. No greater than 10.


#### Links

- [MediaWiki API](https://www.mediawiki.org/wiki/API:Main_page)
- [Wikipedia GitHub](https://github.com/goldsmith/Wikipedia)
- [Wikipedia Docs](https://wikipedia.readthedocs.io/en/latest/)


### Wolfram Alpha

```
(en-US)
- "On Wolfram Alpha search for the integral of cos(x)"
- "On Wolfram Alpha search for Barack Obama's age"

```

#### Requirements
- wolframalpha

#### Options
- `app_id`: Your app id.
- `lang`: Choose your language. Default: `en`

#### Links

- [Wolfram Alpha API](http://developer.wolframalpha.com)
- [Wolfram Alpha GitHub](https://github.com/jaraco/wolframalpha)
- [Wolfram Alpha Docs](http://products.wolframalpha.com/docs/WolframAlpha-API-Reference.pdf)
