# Knowledge Package

The Knowledge package aims at answering general questions.

#### Requirements
- wolframalpha

#### Usage

1. Duplicate the file `packages/knowledge/config/config.sample.json` and rename it `config.json`.
2. Set your language and other settings.
3. This package needs a few libraries to work properly. To install it, from inside leon directory, `cd bridges/python`
4. `pipenv install wolframalpha`
5. Done!

```
(en-US)
- "On Wolfram Alpha search for the integral of cos(x)"
- "On Wolfram Alpha search for the age of Barack Obama"

```

#### Options
- `lang`: Choose your language. Default: `en`

#### Links

- [Wolfram Alpha API](http://developer.wolframalpha.com)
- [Wolfram Alpha GitHub](https://github.com/jaraco/wolframalpha)
- [Wolfram Alpha Docs](http://products.wolframalpha.com/docs/WolframAlpha-API-Reference.pdf)
