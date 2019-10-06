# Akinator Package

The Akinator package is an online game where you think of a character, real or fiction, and by asking you questions the site will try to guess who you're thinking of.


### Usage
```
(en-US)
- "Play Akinator"
```


### Setup

1. Duplicate the file `packages/knowledge/config/config.sample.json` and rename it `config.json`.
2. Set your language and other settings.
4. This package needs a few libraries to work properly. To install it, from inside leon directory, `cd bridges/python`
5. `pipenv install requests akinator.py`
6. Done!


### Requirements
- requests
- akinator.py


### Options
- `lang`: Choose your language. Default: `en`


#### Links

- [akinator.py GitHub](https://github.com/NinjaSnail1080/akinator.py)
