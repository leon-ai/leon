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
