# Contributing

Thanks a lot for your interest in contributing to Leon! :heart:

**Leon needs open source to live**, the more skills he has, the more skillful he becomes.

**Before submitting your contribution**, please take a moment to review this document.

Please note we have a [code of conduct](https://github.com/leon-ai/leon/blob/develop/.github/CODE_OF_CONDUCT.md), please follow it in all your interactions with the project.

## How You Can Help

Here are few examples about how you could help on Leon, by:

- [Creating a new module](https://docs.getleon.ai/packages-modules).
- [Working on new features](http://roadmap.getleon.ai) (what is in backlog or todo).
- [Suggesting new ideas](https://github.com/leon-ai/leon/issues/new/choose).
- [Reporting a bug](https://github.com/leon-ai/leon/issues/new?labels=bug&template=BUG.md).
- [Improving the documentation](https://github.com/leon-ai/docs.getleon.ai) (translations, typos, better writing, etc.).
- [Sponsoring Leon](http://sponsor.getleon.ai).

## Pull Requests

**Working on your first Pull Request?** You can learn how from this _free_ series [How to Contribute to an Open Source Project on GitHub](https://egghead.io/courses/how-to-contribute-to-an-open-source-project-on-github).

- **Please first discuss** the change you wish to make via [issue](https://github.com/leon-ai/leon/issues),
  email, or any other method with the owners of this repository before making a change.
  It might avoid a waste of your time.

- The `master` branch is actually used as a snapshot of the latest stable release. **Do not submit your PRs
  against the `master` branch**.

- Ensure your code **respect our coding standards** (cf. [.eslintrc.json](https://github.com/leon-ai/leon/blob/develop/.eslintrc.json)).
  To do so, you can run:

  ```sh
  npm run lint
  ```

- Make sure your **code passes the tests**. You can run the tests via the following command:

  ```sh
  npm test
  ```

  If you're adding new features to Leon, please include tests.

## Development Setup

Choose the setup method you want to go for.

### Single-Click

Gitpod will automatically setup an environment and run an instance for you.

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/leon-ai/leon)

### Basic

```sh
# Clone the repository
git clone https://github.com/leon-ai/leon.git leon

# Go to the project root
cd leon

# Install
npm install

# Check the setup went well
npm run check

# Run the development server
npm run dev:server

# Run the development web app
npm run dev:app
```

### Docker

```sh
# Clone the repository
git clone https://github.com/leon-ai/leon.git leon

# Go to the project root
cd leon

# Build
npm run docker:build

# Run the development server and the development web app
npm run docker:dev
```

## Versioning

- We use [Semantic Versioning](https://semver.org) for releases.

## Commits

The commit message guideline is adapted from the [AngularJS Git Commit Guidelines](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#-git-commit-guidelines).

### Types

Types define which kind of changes you made to the project.

| Types    | Description                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------- |
| BREAKING | Changes including breaking changes.                                                                      |
| build    | New build version.                                                                                       |
| chore    | Changes to the build process or auxiliary tools such as changelog generation. No production code change. |
| ci       | Changes related to continuous integration only (GitHub Actions, CircleCI, etc.).                         |
| docs     | Documentation only changes.                                                                              |
| feat     | A new feature.                                                                                           |
| fix      | A bug fix.                                                                                               |
| perf     | A code change that improves performance.                                                                 |
| refactor | A code change that neither fixes a bug nor adds a feature.                                               |
| style    | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc.). |
| test     | Adding missing or correcting existing tests.                                                             |

### Scopes

Scopes define high-level nodes of Leon.

- web app
- server
- tcp server
- python bridge
- hotword
- skill/skill_name

### Examples

```sh
git commit -m "feat(server): awesome new server feature"
git commit -m "docs(skill/leon): fix spelling"
git commit -m "chore: split training script into awesome blocks"
git commit -m "style(web app): remove chatbot useless parentheses"
```

## Sponsor

You can also contribute by [sponsoring Leon](http://sponsor.getleon.ai).

Please note that I dedicate most of my free time to Leon.

By sponsoring the project you make the project sustainable and faster to develop features.

The focus is not only limited to the activity you see on GitHub but also a lot of thinking about the direction of the project. Which is naturally related to the overall design, architecture, vision, learning process and so on...

## Contributing to the Python Bridge or TCP Server

Leon makes use of two binaries, the Python bridge and the TCP server. These binaries are compiled from Python sources.

The Python bridge is used to communicate between the core and skills made with Python.

The TCP server is used to communicate between the core and third-party nodes, such as spaCy.

### Set Up the Python Environment

To contribute to these parts, you need to set up a Python environment running with a specific Python version and a specific Pipenv version.

It is recommended to use Pyenv to manage your Python versions.
If you are on Linux, you can run the following to install Pyenv, otherwise, please refer to the [Pyenv documentation to install it](https://github.com/pyenv/pyenv#installation):

```bash
# Update registry
sudo apt-get update

# Install Pyenv deps
sudo apt-get install make build-essential libssl-dev zlib1g-dev \
libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev

# Install Pyenv
curl https://pyenv.run | bash

# Add output lines to .bashrc

# Restart shell
exec "$SHELL"
```

Once Pyenv installed, run:

```bash
# Install Python
pyenv install 3.9.10 --force
pyenv global 3.9.10

# Install Pipenv
pip install pipenv==2022.7.24
```

Your Python environment should be ready now. So now you can set up the respective environments according to what you are going to contribute to and build them:

```bash
# Set up the Python bridge environment
npm run setup:python-bridge

# Set up the TCP server environment
npm run setup:tcp-server
# If you are in China, you can run this to download models faster:
npm run setup:tcp-server cn

# Once your code changes are done, you can build via:

# Build the Python bridge
npm run build:python-bridge

# Build the TCP server
npm run build:tcp-server

# Run the Python bridge
./bridges/python/dist/{OS-CPU_ARCH}/leon-python-bridge server/src/intent-object.sample.json

# Run the TCP server
./tcp_server/dist/{OS-CPU_ARCH}/leon-tcp-server en
```

## Spread the Word

Use [#LeonAI](<https://twitter.com/search?f=live&q=%23LeonAI%20(from%3Agrenlouis%20OR%20from%3Alouistiti_fr)&src=typed_query>) if you tweet about Leon and/or mention [@grenlouis](https://twitter.com/grenlouis).
