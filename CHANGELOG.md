# [1.0.0-beta.5](https://github.com/leon-ai/leon/compare/v1.0.0-beta.4...1.0.0-beta.5) (2021-12-28) / Refocus

*This release marks a major turn in the future versions of the Leon core. Please [read this blog post](https://blog.getleon.ai/i-ran-away-from-open-source/) to know more.*

### BREAKING CHANGES
 - Node.js 16+ and npm 8+ minimum requirements [2f66f1c1](https://github.com/leon-ai/leon/commit/2f66f1c17bb2e4a1c18b4251d49de252b8d87344)
### Features
 - **server:** support arrays on NER between conditions [7cf7f979](https://github.com/leon-ai/leon/commit/7cf7f9791254e1950fe9128ce1b3a58079cc2ada)
### Bug Fixes
 - jest-extended new setup due to latest update [02f766d6](https://github.com/leon-ai/leon/commit/02f766d6a8453609ebaec78356aa6e6d4df0967b)
### Performance Improvements
 - Windows setup on DeepSpeech dep removal [13f5a49f](https://github.com/leon-ai/leon/commit/13f5a49f678f8f67a93b67d4f558cddcf237e204)
### Documentation Changes
 - URL redirect managed by registrar [c16d5b28](https://github.com/leon-ai/leon/commit/c16d5b280b758f7e18305e30678adec79f0a0716)  

# [1.0.0-beta.4](https://github.com/leon-ai/leon/compare/1.0.0-beta.2...1.0.0-beta.4) (2021-05-01) / Getting Rid of Dust

*This release includes a lot of changes that are made under the hood and are not displayed here, please **[read the blog post](https://blog.getleon.ai/getting-rid-of-dust-1-0-0-beta-4/)** to know more.*

### BREAKING CHANGES

 - **package/checker:** introduce Have I Been Pwned v3 API with API key ([0ca89fe3](https://github.com/leon-ai/leon/commit/0ca89fe32d51c80cec5f9446acf14990390a5917))
 - **server:**
   - AWS SDK new structure due to v3 and adapt Amazon Polly changes ([f15f2db7](https://github.com/leon-ai/leon/commit/f15f2db78e5781d05e5e2bcb186645966d17debf))
   - IBM Watson TTS and STT new structure ([f41ea0e9](https://github.com/leon-ai/leon/commit/f41ea0e9a1479bfd6a1cb2e8d1f70aec744c685b) | [2668c295](https://github.com/leon-ai/leon/commit/2668c295880ee753ef7ca26a91dbc7e0901febff))
### Features 
 - **package/calendar:** introduce To-Do list module ([0cdd73d6](https://github.com/leon-ai/leon/commit/0cdd73d6c24a287915f691e3b12edacd75fd383a) | [857be947](https://github.com/leon-ai/leon/commit/857be947792c650ac35847e14fc41064008cef24) | [2041be14](https://github.com/leon-ai/leon/commit/2041be14dbc01640a61de96d1982cc20cd05a8b3) | [12e8f5c3](https://github.com/leon-ai/leon/commit/12e8f5c3bfb436aa212557cd99d9926aa431ab4f) | [8575e9e3](https://github.com/leon-ai/leon/commit/8575e9e3ef01499d9f7be6d313a85d48549e9107) | [5e128df0](https://github.com/leon-ai/leon/commit/5e128df023977525de3e66ce2826aace87569308) | [602aa694](https://github.com/leon-ai/leon/commit/602aa694ac49333f48c119cf2ca2aa7f54b8ae44) | [b9693df9](https://github.com/leon-ai/leon/commit/b9693df90cbc01067e18e64db4d377e41b3fd1d4) | [581da8cd](https://github.com/leon-ai/leon/commit/581da8cd9806323aabb0e85778d645df3c0948b9) | [53f7db55](https://github.com/leon-ai/leon/commit/53f7db55c6e916751f1d59c239628d5ea8914009) | [ae073971](https://github.com/leon-ai/leon/commit/ae0739717b6a17373d8f9bc69571c67c1c571b4a))
 - **package/checker:** introduce Have I Been Pwned module ([61c1b55a](https://github.com/leon-ai/leon/commit/61c1b55af5691c03f6a6dae0cf3f236a374f1fe7) | [5a999bc6](https://github.com/leon-ai/leon/commit/5a999bc63aa0c667c4e3092daac6a05a6c4b4499) | [36368664](https://github.com/leon-ai/leon/commit/36368664fce8bcf0c17c4c83818aeb418f1e2f23) | [a7a6d885](https://github.com/leon-ai/leon/commit/a7a6d885a83455163eeca74a355177d65db156b8) | [c73ba52b](https://github.com/leon-ai/leon/commit/c73ba52ba8575a64b3329e59a50050d15281d0ec) | [8374e548](https://github.com/leon-ai/leon/commit/8374e5481022de9b134f49180a8dfe28db136261) | [a476fd0f](https://github.com/leon-ai/leon/commit/a476fd0f38f18bf8035db213be2c55f83871038d))
 - **package/network:** add speedtest module ([09ad4340](https://github.com/leon-ai/leon/commit/09ad43406d3df8ca65f385a91c159def51f91811))
 - **server:**
   - add regex entity type [3fda3526](https://github.com/leon-ai/leon/commit/3fda3526c7425bdea4b669474fa77efd61c06a8e) 
   - catch unsupported action entity type [5bc6c3f1](https://github.com/leon-ai/leon/commit/5bc6c3f116d6b9ece2cc3bebdbdb08f019ee90b9) 
   - NER backbone [24cf3c9a](https://github.com/leon-ai/leon/commit/24cf3c9a4facd05a4c626ff9d2e7c83a5ae15298) 
   - introduce actions module [b449376f](https://github.com/leon-ai/leon/commit/b449376f61dc995e2e264c6a14ba123926f5cc58) 
### Bug Fixes
 - set correct status code for GET /downloads [690f1841](https://github.com/leon-ai/leon/commit/690f1841d681a1e48e1837e3e166228d6c2ddaf6) 
 - take `.env` in consideration when using Docker [d38e6095](https://github.com/leon-ai/leon/commit/d38e6095f9b71467b8486430fba4bb7007ec4c5a) 
 - spinner test [9071c927](https://github.com/leon-ai/leon/commit/9071c92790be674687590e4a896bbf44bc26fb43) 
 - e2e tests by adding modules actions level [5cf77d90](https://github.com/leon-ai/leon/commit/5cf77d9011a80b326f229b2309a6910ac0f1cfa2) 
  
 - **package/leon:** fix english translations [90225707](https://github.com/leon-ai/leon/commit/90225707f94154021cadeb9c61bdc48c3de5aa29)
 - **package/network:** make use of new compatible speedtest lib [0c925626](https://github.com/leon-ai/leon/commit/0c925626df65858fa039972b3f3d5f38fde93eb6) 
 - **package/trend:**
   - GitHub module new scraping [68414937](https://github.com/leon-ai/leon/commit/6841493740ca859000c1fd8d692b73fc79fcf500) 
   - when there is no star provided on the GitHub module [563fb409](https://github.com/leon-ai/leon/commit/563fb40955e2deb5c6d0bd064fc9cc8766a6fcaf) 
 - **server:**
   - make use of Basic plugin from the main NLP container [e1d5bed3](https://github.com/leon-ai/leon/commit/e1d5bed3e688db566a0cb803dda5c2d57c599d8c) 
   - NER trim entity on after conditions [fa6a5a43](https://github.com/leon-ai/leon/commit/fa6a5a43a60b493aa403a44957082382494c129b) 
### Documentation Changes
 - add minimum Pipenv version requirement to README [72e46bd6](https://github.com/leon-ai/leon/commit/72e46bd6c175a4a149fb6b14522823b224d7c152) 
 - hunt broken links [b2a22792](https://github.com/leon-ai/leon/commit/b2a2279243e7566b57fb7f696024bdf08294e853) 
 - add "ci" commit type in CONTRIBUTING.md [09e2672b](https://github.com/leon-ai/leon/commit/09e2672b0b399f5ce9dd7cd446d04f4d6fd7c13a) 
 - use emojies in README [0ea7a78b](https://github.com/leon-ai/leon/commit/0ea7a78b7c94dc44c992913ae1c90fb1cf8a7692) 
 - add social badges to README [c55c7532](https://github.com/leon-ai/leon/commit/c55c7532b25bf420c4819be71b0f9c21ccc58711) 
 - Node.js 14 requirement [d1034bd1](https://github.com/leon-ai/leon/commit/d1034bd135fd5a6314a1571d4088fd85a8e6a1da)

# [1.0.0-beta.2](https://github.com/leon-ai/leon/compare/1.0.0-beta.1...1.0.0-beta.2) (2019-04-24)
### Features
 - can send custom HTTP headers
  ([2685cdab](https://github.com/leon-ai/leon/commit/2685cdab07cc1a9ea418eab812e5163d2dd0da90))
 - allow HTML output
  ([ec3f02df](https://github.com/leon-ai/leon/commit/ec3f02dfaf2f4b7623ce350350ebee28cf18740e))
 - NLU improvement with node-nlp
  ([6585db71](https://github.com/leon-ai/leon/commit/6585db718ccae1d750a35783075cf61cc8fe84f1))

 - **package/trend:**
   - add answer when the Product Hunt developer token is not provided
  ([f40b479b](https://github.com/leon-ai/leon/commit/f40b479b295247c5a8a0e6ed81afe56fadfd2730))
   - Product Hunt module done
  ([37794306](https://github.com/leon-ai/leon/commit/3779430621bef970be0e8d048eb0b4bf160ae8a4))
   - basics done on the Product Hunt module
  ([32cc7dbe](https://github.com/leon-ai/leon/commit/32cc7dbe36592fb9618d9c10da5f05a4be7e41b6))
   - complete dedicated answers according to the technology and given time
  ([8997d691](https://github.com/leon-ai/leon/commit/8997d6917445f837c9647a5a9b4d6998d2df4952))
   - GitHub module done
  ([7c6f3922](https://github.com/leon-ai/leon/commit/7c6f3922f299193ee0fb54d0fc97f8b436fc706b))
   - be able to choose a limit and a date range for the GitHub module
  ([3c088371](https://github.com/leon-ai/leon/commit/3c0883716e1c10371c399843a578095a1e16781d))
   - format GitHub results in one message
  ([9d026b94](https://github.com/leon-ai/leon/commit/9d026b94efa8871d421ae2b593b96622a98537ac))
   - simple GitHub module results
  ([5baec074](https://github.com/leon-ai/leon/commit/5baec07455f453d4ad003f1da360b2663b7e15e0))
   - list GitHub trends in HTML raw
  ([3441629e](https://github.com/leon-ai/leon/commit/3441629e3cde933b322cb114d9f1bc3ef0eb3944) | [6b932e94](https://github.com/leon-ai/leon/commit/6b932e947fc365ea6435fda798b7cca32708b443))
   - expressions dataset and structure
  ([f406a5a0](https://github.com/leon-ai/leon/commit/f406a5a09894e12c56a1e76dda609adada00b0d7) | [f54c2272](https://github.com/leon-ai/leon/commit/f54c2272b4b4dc5c56b512b0ccc1519d77ef15a3))
### Bug Fixes
 - Leon was not fully installed with Docker if a `.env` file was existing
  ([c8a68ab0](https://github.com/leon-ai/leon/commit/c8a68ab02eec9ddaf803b6e36cd7e91a4989cdea))

 - **package/trend:**
  when there is no contributor on GitHub module
  ([d845e49b](https://github.com/leon-ai/leon/commit/d845e49b0f18caeb306e2d399c50a03883b2f55d))
 - **server:**
   - skip Pipenv locking until they fix it
  ([029381e3](https://github.com/leon-ai/leon/commit/029381e3256933f37f5c2950c4eb1f0192f55ec6) | [ecfdc73f](https://github.com/leon-ai/leon/commit/ecfdc73f8290dd9e1910df9519095516a1227763))
### Documentation Changes
 - add `What is Leon able to do?` section in the readme
  ([87f53c91](https://github.com/leon-ai/leon/commit/87f53c91368141966959f3ad7299bb7b643828a5) | [d558fc8b](https://github.com/leon-ai/leon/commit/d558fc8b7c6494babf5dec799802227f77c33d8a))
 - open-source != open source
  ([16a9372e](https://github.com/leon-ai/leon/commit/16a9372e05d4d31a7a39a65a52d4708b72499d4c) | [2155cd88](https://github.com/leon-ai/leon/commit/2155cd88decbbd671bd58840291d9330ce06ebba))



# [1.0.0-beta.1](https://github.com/leon-ai/leon/compare/1.0.0-beta.0...1.0.0-beta.1) (2019-02-24)
### Features
 - add Docker support
  ([209760db](https://github.com/leon-ai/leon/commit/209760dba747001300692fb6a6af97543de584d6))

### Bug Fixes
 - **package/checker:**
  isitdown module fails with capital letters in URL
  ([ada6aaef](https://github.com/leon-ai/leon/commit/ada6aaef4bada47e87d28f9f6eaa05b9e23f58d2))
 - **web app:**
  enable environment variables
  ([a438d6f9](https://github.com/leon-ai/leon/commit/a438d6f942812f74e3dda75a9875609f8bea21cd))
### Performance Improvements

 - **web app:**
  favicon compression
  ([33dbcb42](https://github.com/leon-ai/leon/commit/33dbcb425eaafba90176ff64e5f689eb36bc6ce1))
### Documentation Changes
 - update README to make the reader genderless
  ([58662658](https://github.com/leon-ai/leon/commit/586626586b7a2f84cb2cd84028111976bc5172f0))
 - use "to rule them all" in README
  ([c74dda4c](https://github.com/leon-ai/leon/commit/c74dda4cb9acc78de143ae01fdc6b4ef0a5ec3ef))

 - **readme:**
  add story write-up
  ([08a68e37](https://github.com/leon-ai/leon/commit/08a68e376b6a9367425947380564120943376500))


# [1.0.0-beta.0](https://github.com/leon-ai/leon/compare/https://github.com/leon-ai/leon.git...1.0.0-beta.0) (2019-02-10)

Initial release.
