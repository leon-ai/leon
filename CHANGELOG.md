# [1.0.0-beta.0](https://github.com/Louistiti/leon/compare/https://github.com/Louistiti/leon.git...v1.0.0-beta.0) (2019-02-10)
### BREAKING CHANGES
 - new CI
  ([9dac4c83](https://github.com/Louistiti/leon/commit/9dac4c83759e56dc5f69ddff895ba1bc6034b442))
 - new CI
  ([705f81c4](https://github.com/Louistiti/leon/commit/705f81c41588f6dd7ca657ffa2007a04375740a6))
 - rename `*-sample*` files to `*.sample*`
  ([7e3ab427](https://github.com/Louistiti/leon/commit/7e3ab427b6150abad8f2ccdc24228ef2ab6d94d2))
 - get rid of gulp.js
  ([c5676cf2](https://github.com/Louistiti/leon/commit/c5676cf271473d083b377897ac928c7c68c9e831))

 - **server:**
   - new Watson STT
  ([deb854b2](https://github.com/Louistiti/leon/commit/deb854b2d6e80b32e009b13b3e3cc067f05ae0bc))
   - new Watson TTS
  ([a5a6d72b](https://github.com/Louistiti/leon/commit/a5a6d72bda2b0b35b03bbbe2c09555b55f605d9e))
   - switch NLP to NLU
  ([32fe88b1](https://github.com/Louistiti/leon/commit/32fe88b1ef26c6ab73066c76c8fc3cd5d2b7b1a4))
   - binary TTS and STT structure
  ([11689e88](https://github.com/Louistiti/leon/commit/11689e88627dfd02e961b7f3bfaa0e5ff2c0333d))
### Features
 - preinstall script
  ([0644296b](https://github.com/Louistiti/leon/commit/0644296b10e857c6811555ab30bad6236d124e60))
 - preinstall script
  ([6793c9f6](https://github.com/Louistiti/leon/commit/6793c9f61ba323b9ee453d5992a8115e41f54131))
 - preinstall script
  ([a53be750](https://github.com/Louistiti/leon/commit/a53be7504c6c8ba3eee5966d2190190733bde069))
 - preinstall script
  ([82299099](https://github.com/Louistiti/leon/commit/82299099600ca7929534bcca4243be01fae1da73))
 - preinstall script
  ([1b0b3e9e](https://github.com/Louistiti/leon/commit/1b0b3e9e33fe8fec0415e1985303610aa002ce3a))
 - preinstall script
  ([231d68d6](https://github.com/Louistiti/leon/commit/231d68d6c7d0ea366784cfd28da95f3a9012cfd5))
 - preinstall script
  ([fb45d9ed](https://github.com/Louistiti/leon/commit/fb45d9ed744d0c473fab7f79e90c25d6723d9b99))
 - check script
  ([e545ac58](https://github.com/Louistiti/leon/commit/e545ac5847f6e38649a494730b99e9a002015470))
 - chatbot visual almost done for the v1
  ([94a2f557](https://github.com/Louistiti/leon/commit/94a2f55757bf06487a2fbd8c84c1eff677568516))

 - **package/leon:**
   - add partner assistant module
  ([794a4d73](https://github.com/Louistiti/leon/commit/794a4d73957cd6b5d7d434b8727426e8a31d0618))
   - add sentence to the whoami module
  ([a241cdc0](https://github.com/Louistiti/leon/commit/a241cdc0bf04515b18bbc40ddb117e092851afd2))
 - **client:**
  voice detection
  ([eec7fc8d](https://github.com/Louistiti/leon/commit/eec7fc8d8f3e28cfd2d844c4319239d88609c77a))
 - **devapp:**
  disable mic when the STT is disabled
  ([e0bf1163](https://github.com/Louistiti/leon/commit/e0bf116360a5b3b43618c04b352cd97f70a161b2))
 - **hotword:**
  server and client ready
  ([a5a8f932](https://github.com/Louistiti/leon/commit/a5a8f9321daff80d52c5a2454281317acb61db7e))
 - **hotword + after-speech:**
  done
  ([db813296](https://github.com/Louistiti/leon/commit/db813296dea8c7f702d186762758bdfe2fad0251))
 - **module:**
   - Bye done
  ([e178de05](https://github.com/Louistiti/leon/commit/e178de0513f5867257621a50b5dabc36790fc64f))
   - Random Number done + Meaning of Life done + Welcome done
  ([5a3b3f75](https://github.com/Louistiti/leon/commit/5a3b3f75e59395ef078cfa3fceca3d89fd364cfe))
   - Greeting done
  ([8a6fa9c5](https://github.com/Louistiti/leon/commit/8a6fa9c52cd1c82c46ed21c4f4af83f615da4bc4))
   - Joke done
  ([367318f7](https://github.com/Louistiti/leon/commit/367318f75101822409f0f00be315f805340a3fe4))
 - **core:**
   - NLP fallback + confidence for each language + French translations written
  ([d8004d12](https://github.com/Louistiti/leon/commit/d8004d1217d146de825ae356d97b97b2d511b192))
   - STT + TTS translations architecture
  ([447efd21](https://github.com/Louistiti/leon/commit/447efd218af96a9c472cbd059ac8813a756640d1))
 - **stt:**
   - Google Cloud STT implemented
  ([216765cc](https://github.com/Louistiti/leon/commit/216765cc42f2ec683233f093152f3ce8b048508d))
   - ASR class created + delete audios file after STT job
  ([69b1fcce](https://github.com/Louistiti/leon/commit/69b1fcce77786cf64aea1af0e643ab0dd7298550))
   - done + need to prepare init models thanks to a thread
  ([46d36990](https://github.com/Louistiti/leon/commit/46d36990398bc2179658efb00ffbbc38cc18a735))
   - client send stream to server + server convert stream to a WAVE file
  ([67ceb99a](https://github.com/Louistiti/leon/commit/67ceb99a9c2620f4ab4e8510c6ef37eb2723d428))
 - **stt and tts:**
  Watson implemented
  ([3dae3d68](https://github.com/Louistiti/leon/commit/3dae3d6811febf0c25032752a07c9fcd26d9580e))
 - **test:**
  this is a test. Close #1
  ([5efe707d](https://github.com/Louistiti/leon/commit/5efe707df7e63c8c12fd3ce54d31b858da75541e))
 - **tts:**
   - Amazon Polly implemented
  ([cd5dbe7a](https://github.com/Louistiti/leon/commit/cd5dbe7a0fa9cd958d4c355db44ee3f82a465b16))
   - Google Cloud TTS implemented
  ([eb3e18e8](https://github.com/Louistiti/leon/commit/eb3e18e82f51f59eb5c7c9fb3afab68d39c04939))
   - done
  ([2e5d3f18](https://github.com/Louistiti/leon/commit/2e5d3f18692f8a45304d9b3d1c0689fd4124c9f0))
   - architecture done + need to delete audio files + forward buffer to the client
  ([85664eef](https://github.com/Louistiti/leon/commit/85664eefc1839dfc946dbc17a55a96119089c6ac))
 - **web app:**
   - add favicon
  ([6d0ae10d](https://github.com/Louistiti/leon/commit/6d0ae10ddb8ba478ad9218a1c23fa686b55555c9))
   - avoid N - 1 duplicate to browse commands history
  ([930eac09](https://github.com/Louistiti/leon/commit/930eac094a61d16013ab4fc320e2a28b853c6f38))
   - chatbot done
  ([520bef6d](https://github.com/Louistiti/leon/commit/520bef6d8e8ab51f0c2478e7b00d1dd34d03ee24))
### Bug Fixes
 - Python output switch key to code
  ([8a7d6124](https://github.com/Louistiti/leon/commit/8a7d6124aeac533f84a23d21b60f6ab51be3b848))
 - setup-stt wget
  ([c1d7a682](https://github.com/Louistiti/leon/commit/c1d7a6827128b97645a2ab610c0e6ae1a1b1188c))
 - dev build app
  ([53681a55](https://github.com/Louistiti/leon/commit/53681a55aee8af803e8a4cb4ba1ea87f7823121e))
 - Windows setup
  ([7609a509](https://github.com/Louistiti/leon/commit/7609a5092a2ce1396387288c6c2df15a6ed9328b))
 - setup offline
  ([c74134b4](https://github.com/Louistiti/leon/commit/c74134b46d2e15d66599ddb0b0dee63f8fc2faed))
 - offline setup on Linux
  ([3278aad6](https://github.com/Louistiti/leon/commit/3278aad6c4b412b5d523482a0e4b4c8ba82ed006))
 - build script
  ([732f9027](https://github.com/Louistiti/leon/commit/732f902755699e5dbb8bc03296f6f326cde83dfe))
 - setup env vars
  ([3606edc4](https://github.com/Louistiti/leon/commit/3606edc4934636c81d74ddf6c42d38b76b75e7e8))
 - .env LANG and LC_ALL
  ([ff652bb5](https://github.com/Louistiti/leon/commit/ff652bb5193d138532901f1eb5fbe63510fb5fae))
 - brain TTS init when enabled
  ([3697c89a](https://github.com/Louistiti/leon/commit/3697c89a3669caee75967152433b3066bd310aa3))
 - multiple things
  ([42bdb88a](https://github.com/Louistiti/leon/commit/42bdb88a68f4e6ab4d48583f6ba934b07f61bb52))
 - setup python packages checking
  ([843a3012](https://github.com/Louistiti/leon/commit/843a3012bfa7864dd34ea513d400a87b3b4e1297))
 - Python version requirements
  ([acebd80b](https://github.com/Louistiti/leon/commit/acebd80b0c99aa703218048d94191121175e9833))
 - chore training
  ([68d559a3](https://github.com/Louistiti/leon/commit/68d559a3a17a9d31700534036af23aaa1c98c08e))
 - CHANGELOG generator
  ([574847b5](https://github.com/Louistiti/leon/commit/574847b5bb7cbadad577f522aeac0546042d354b))
 - this is a fix
  ([3e62378e](https://github.com/Louistiti/leon/commit/3e62378eff270b6beb7fa4dc4bb368f3859d806b))

 - **.gitignore:**
  .json TinyDB
  ([13fdcd63](https://github.com/Louistiti/leon/commit/13fdcd6307115c1409dd1389d27bbe5d6b213d04))
 - **changelog:**
  happy to fix that bug
  ([276a78d1](https://github.com/Louistiti/leon/commit/276a78d17e2c37371412b94e1b19971b4378a099))
 - **config:**
  voice samples
  ([c497c685](https://github.com/Louistiti/leon/commit/c497c68560525bc718be83c41edb45c5cebbb75b))
 - **devapp:**
  do not send query while writing
  ([8344d861](https://github.com/Louistiti/leon/commit/8344d8613e4fe737ab187a4a74f61d038fb8e5da))
 - **package/leon:**
   - "à bon escient"
  ([41868833](https://github.com/Louistiti/leon/commit/41868833e1659c9b4f6752b4ed190acaadff3c09))
   - Siri answer
  ([a9a2d469](https://github.com/Louistiti/leon/commit/a9a2d469bb21b7f10c805b77f1efa8905a5b3d67))
 - **server:**
   - ASR FFmpeg mono channel
  ([49c5abfc](https://github.com/Louistiti/leon/commit/49c5abfc7c56f136ff4ab12e010b1b7ece750163))
   - brain execution was stopping after the first query
  ([9da0c9a9](https://github.com/Louistiti/leon/commit/9da0c9a9c0a9de5a2d3825b773a8d26335eb71ef))
 - **setup:**
  core files path
  ([6a3fb9b0](https://github.com/Louistiti/leon/commit/6a3fb9b08cfa75556181c742a41eb5f05512e938))
 - **test:**
   - latest test
  ([3bd2e95a](https://github.com/Louistiti/leon/commit/3bd2e95afabde3f549110681a5497183ea98b0dc))
   - this is another fix
  ([9de09067](https://github.com/Louistiti/leon/commit/9de09067d4ddeb840e8eac4e91b0f4990025702c))
 - **web app:**
  allow init even when mic is not allowed
  ([da469d9d](https://github.com/Louistiti/leon/commit/da469d9df34920b6c542d75d9046c7fdedf9bf0b))
### Performance Improvements
 - improve for loop
  ([f3c64495](https://github.com/Louistiti/leon/commit/f3c644956d724b0ef684cd5a5314bfd25c9bfcb7))

### Documentation Changes
 - update logo size
  ([df813c49](https://github.com/Louistiti/leon/commit/df813c4958bb7b0febf4710595ad7d2d1dac4ad8))
 - README edit video preview
  ([b77f86f4](https://github.com/Louistiti/leon/commit/b77f86f4a09fd1f55e2bca8125d7fc034aa4914a))
 - README video
  ([41761226](https://github.com/Louistiti/leon/commit/417612264fdfb5280f2b7567788501304de45966))
 - CONTRIBUTING adding roadmap
  ([fd99683f](https://github.com/Louistiti/leon/commit/fd99683ff1bed00880832d5467aa2613b8ebd4ca))
 - add Twitter in the README "Stay Tuned" section
  ([c6dfef7a](https://github.com/Louistiti/leon/commit/c6dfef7a7f56381064c8672f11ece308e810be29))
 - badges updated
  ([f3dcb203](https://github.com/Louistiti/leon/commit/f3dcb203d14f49c0dac5d9d11b663a4908e09e7b))
 - typo fix
  ([cae01084](https://github.com/Louistiti/leon/commit/cae01084e3a4611c32b83ab08faada51f841d808))
 - improve README
  ([087a02bf](https://github.com/Louistiti/leon/commit/087a02bfa76892986c7e173fbbb703ef8fe70513))
 - supported OS
  ([91353dee](https://github.com/Louistiti/leon/commit/91353deef673d39b9dce6fb51d0d7862edf9362a))
 - improve README
  ([6c201e27](https://github.com/Louistiti/leon/commit/6c201e2709567f510f6a5fb93d34715f1f9f682b))
 - improve README
  ([ec1406c2](https://github.com/Louistiti/leon/commit/ec1406c215245a7761c89de8256759c8017c103f))
 - improve README
  ([0cdc683e](https://github.com/Louistiti/leon/commit/0cdc683ec65c32907308926e703915405f723233))
 - CONTRIBUTING improvement
  ([7dba9928](https://github.com/Louistiti/leon/commit/7dba9928ce8e2df2b7dc26b3ac2671779edb23e3))
 - contributing improvement
  ([6716585b](https://github.com/Louistiti/leon/commit/6716585b5250b1309d796e36ee2d865b736bd17f))
 - italic README catchphrase
  ([dad0c268](https://github.com/Louistiti/leon/commit/dad0c2681a82432ee292b145f400befd5f537a07))
 - tiny README change
  ([633f5f29](https://github.com/Louistiti/leon/commit/633f5f29e5b32f565cb6c7d53ec309aba77b0121))
 - improve README
  ([4ee74263](https://github.com/Louistiti/leon/commit/4ee74263fd52028cd1a12479990531fe1b9edba4))
 - improve README
  ([2541e466](https://github.com/Louistiti/leon/commit/2541e46677556427f49e484cbdf54496859da24e))
 - improve README
  ([d469c9e5](https://github.com/Louistiti/leon/commit/d469c9e5777819afeec671b2951d360375891164))
 - edit donation link
  ([c1b3e45e](https://github.com/Louistiti/leon/commit/c1b3e45e3a397e424d42d59348bf8b3425698858))
 - adjust few things
  ([abf3bbc5](https://github.com/Louistiti/leon/commit/abf3bbc5a70c4da3007b648428713757f9568e4a))
 - README or to OR
  ([7d10ef26](https://github.com/Louistiti/leon/commit/7d10ef26ba24d59fc1c0d6b041d1d14bbed7f9e1))
 - fix
  ([22b1ab5b](https://github.com/Louistiti/leon/commit/22b1ab5bc6a468d7ffe23e1857acca8c9301ef92))
 - fix
  ([11a6df36](https://github.com/Louistiti/leon/commit/11a6df36fa9d030cac063a15057a7463eca0684f))
 - docs.getleon.ai redirect
  ([bba41cd9](https://github.com/Louistiti/leon/commit/bba41cd97d41858781185f5cd5866dde3f2cb754))
 - sentence improvement
  ([18720175](https://github.com/Louistiti/leon/commit/1872017535c36c16ca59ca2ee9c378244159fd5c))
 - improve commit message description
  ([3d9698bf](https://github.com/Louistiti/leon/commit/3d9698bffc68413c7c429725eae45cf3edecc1db))
 - README.md done
  ([300b1538](https://github.com/Louistiti/leon/commit/300b15382d0fb7ecf9c5275304c0798f8eaadb5c))
 - README
  ([105965f3](https://github.com/Louistiti/leon/commit/105965f3ab65cfc7157e66d07fff4ba0065b863b))
 - README
  ([6b089d16](https://github.com/Louistiti/leon/commit/6b089d168a80ce197da1e38f958a3df802d72f6b))
 - README
  ([1e4eb629](https://github.com/Louistiti/leon/commit/1e4eb629924290e2b47c4e078e8085faeea9149d))
 - README
  ([e8d6039f](https://github.com/Louistiti/leon/commit/e8d6039f1ef073599c847ef0cc5fb43c65505a89))
 - README
  ([d999bdc3](https://github.com/Louistiti/leon/commit/d999bdc385768f2d87427ba1cc229aa71c0855f2))
 - QUESTION.md quick fix
  ([05c74653](https://github.com/Louistiti/leon/commit/05c74653fdbc86173f8042dd17f1f74f048a3c20))
 - QUESTION.md quick fix
  ([6a94f9da](https://github.com/Louistiti/leon/commit/6a94f9da691217e9590a78ac53622db50f953259))
 - ISSUE_TEMPLATE/QUESTION.md
  ([6f97614b](https://github.com/Louistiti/leon/commit/6f97614b6d16c4ebaa0561393efb996519dc2426))
 - ISSUE_TEMPLATE/DOCS.md
  ([ba4b83f1](https://github.com/Louistiti/leon/commit/ba4b83f1b0ac514648294ecfd466d4188bc8d5d0))
 - ISSUE_TEMPLATE/FEATURE_REQUEST.mdt and ISSUE_TEMPLATE/IMPROVEMENT.md
  ([f48ad692](https://github.com/Louistiti/leon/commit/f48ad692d264f84345631f3f79cea1fac5a5748b))
 - delete tmp BUG.md
  ([3e76cf29](https://github.com/Louistiti/leon/commit/3e76cf29dcb95e263339850127b4ef7590feb762))
 - ISSUE_TEMPLATE/BUG.md
  ([efcbdffc](https://github.com/Louistiti/leon/commit/efcbdffc026608302a1bbfce160bf0d995a356ca))
 - README.md quick fix
  ([c9414490](https://github.com/Louistiti/leon/commit/c9414490c9956e35ae466973d4fad92f87053561))
 - README.md quick fix
  ([8f242248](https://github.com/Louistiti/leon/commit/8f2422481e5eabc151f6f8adea04772dc6045669))
 - README.md skeleton
  ([6ab10817](https://github.com/Louistiti/leon/commit/6ab108179c90dc06f71a7a5acc9e6d7f6f7c4539))
 - ISSUE_TEMPLATE.md quick fix
  ([e2966435](https://github.com/Louistiti/leon/commit/e296643598dc10e4afb75472e71f300aaf16ca73))
 - ISSUE_TEMPLATE.md done
  ([e6149798](https://github.com/Louistiti/leon/commit/e6149798b0021bacf9ad8a0ed1d2ed47c489098f))
 - ISSUE_TEMPLATE.md heart
  ([180a329c](https://github.com/Louistiti/leon/commit/180a329c71edb55437d59d3753974b60323903bc))
 - ISSUE_TEMPLATE.md tmp
  ([b04b1acc](https://github.com/Louistiti/leon/commit/b04b1acc3558b6193c95a0d26dc664519fdbeac3))
 - PULL_REQUEST_TEMPLATE.md
  ([25264a80](https://github.com/Louistiti/leon/commit/25264a808900d0713418ec0b2d440951052e01fc))
 - finale CONTRIBUTING.md
  ([776088fc](https://github.com/Louistiti/leon/commit/776088fc7f2d106b12b2a0df0fd9fcec66568651))
 - quick fix
  ([51742875](https://github.com/Louistiti/leon/commit/51742875e50b9513415beabc5dd0ef926a125628))
 - quick fix
  ([b21e8553](https://github.com/Louistiti/leon/commit/b21e8553a01c1088d4450ff19f192b602675d66d))
 - add heart to CONTRIBUTING.md
  ([3e818c6e](https://github.com/Louistiti/leon/commit/3e818c6ec309cabab5eee220f0dbd20b6e77a28a))
 - CONTRIBUTING.md
  ([9c93fdf0](https://github.com/Louistiti/leon/commit/9c93fdf02d7e4543e01164fae3f7a5bba38e837f))
 - Code of Conduct latest version
  ([e09c0785](https://github.com/Louistiti/leon/commit/e09c0785274774e95802780a3fc183a39230bde1))
 - Code of Conduct
  ([b170adb8](https://github.com/Louistiti/leon/commit/b170adb8f3183cab2dbc83dd0850eec03764776d))
 - small changes on README.md and LICENSE.md
  ([45650d36](https://github.com/Louistiti/leon/commit/45650d3602606571f27e73aed9955871ec8fb5b2))
 - clean CHANGELOG
  ([5d32522b](https://github.com/Louistiti/leon/commit/5d32522b4904264de074ff6e063b28c72f746c02))
 - README PRs welcome badge
  ([dee8eb99](https://github.com/Louistiti/leon/commit/dee8eb99fc8fcd181cdf6799120448a38e958fdf))
 - README PRs welcome badge
  ([f141153e](https://github.com/Louistiti/leon/commit/f141153e02be33f56a5b4e95f4f260a07c078963))
 - README badges
  ([75b6abf7](https://github.com/Louistiti/leon/commit/75b6abf783f32fde5ca4df5e329046da3701edac))
 - update README
  ([2ad16984](https://github.com/Louistiti/leon/commit/2ad16984c62c3190efd3c1c0c66709da047246a1))
 - license updated
  ([b5c87cfb](https://github.com/Louistiti/leon/commit/b5c87cfb4da79fc492c14f048f44ce85ba6526e0))
 - this is a test
  ([e54758fe](https://github.com/Louistiti/leon/commit/e54758fe63a15e70cd9618279ec577cb99d28294))
 - docs(CHANGELOG.md)
  ([e289a74c](https://github.com/Louistiti/leon/commit/e289a74ccca82ee20b8b7e453282d3fc61dd1e0f))

 - **changelog:**
   - reset
  ([d9739c81](https://github.com/Louistiti/leon/commit/d9739c81d204d317d19dd3c27311e7861bb0a90a))
   - here is a new test
  ([2aabbf26](https://github.com/Louistiti/leon/commit/2aabbf262b4900287aa324098d3a7cf6020ab8fa))
   - add new chore
  ([8eaa9c75](https://github.com/Louistiti/leon/commit/8eaa9c757929ec648720c05866c23a0aa9548a8c))
   - just few tests
  ([0948adbe](https://github.com/Louistiti/leon/commit/0948adbeba05e71eaa0f17dee57b8a62b216826f))
 - **package.json:**
  homepage URL
  ([d82f34d0](https://github.com/Louistiti/leon/commit/d82f34d069ac7c14ddecc07dad1689b752c3fb61))
 - **package/checker:**
  README
  ([6ddedd24](https://github.com/Louistiti/leon/commit/6ddedd24a5f10a594ac402bb256f7feb01f70f16))
 - **package/leon:**
  README
  ([3cde3273](https://github.com/Louistiti/leon/commit/3cde3273f6b0fa207d0bcd4b85040843eec4f3ba))
 - **package/videodownloader:**
   - quick fix
  ([bf16c2c6](https://github.com/Louistiti/leon/commit/bf16c2c64cdd0b596762761e86fb9917efef22f3))
   - README
  ([3ac3f47d](https://github.com/Louistiti/leon/commit/3ac3f47d4df716be8025096bd5fd8e4cf9c5393a))
 - **readme:**
   - specify recommended virtual env
  ([d98cfb72](https://github.com/Louistiti/leon/commit/d98cfb72589fb257015e4eabc182b6ae1b497d85))
   - another test
  ([cae8cf8f](https://github.com/Louistiti/leon/commit/cae8cf8f46ee25a06ae87c878bdfd39e5efc15f8))
   - alphabetical testing
  ([6fcc867d](https://github.com/Louistiti/leon/commit/6fcc867dbcec1b34239d9d4d73d0fe26bc8f57ec))


