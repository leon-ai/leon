# [1.0.0-beta.7](https://github.com/leon-ai/leon/compare/v1.0.0-beta.6...v1.0.0-beta.7) (2022-08-24) / A Much Better NLP

*Please [read this blog post](https://blog.getleon.ai/a-much-better-nlp-and-future-1-0-0-beta-7/) to know more about all the new features and the exciting future of Leon.*

### BREAKING CHANGES
 - remove legacy packages [07743657](https://github.com/leon-ai/leon/commit/07743657cd2954e7f850c08eea7c032c24b28a96) 
  
### Features
 - create new NLP skills resolvers model + NLP global resolvers model [602604e4](https://github.com/leon-ai/leon/commit/602604e43788c6b6be8c402d54fe54342d0cd5d6) 
 - better isolate skill resolvers from global resolvers + finish up Akinator skill [905d248e](https://github.com/leon-ai/leon/commit/905d248ebf7e84b1ccc74450520228aef9a8804a) 
 - transfer language from core to skills + support thematics on Akinator skill [b35a249b](https://github.com/leon-ai/leon/commit/b35a249bf68000d6708aaee4abc4cd97f5b80035) 
 - actions on slot level + akinator skill progress [7101b8b4](https://github.com/leon-ai/leon/commit/7101b8b4b828b49e009da2fcdac7c5ed2e48c8f8) 
 - add Cartesian sample training on resolvers + enum entities [6ed88a59](https://github.com/leon-ai/leon/commit/6ed88a5946c77b356e49fe8b9cbe890b8dd1f037) 
 - map skills resolvers intents [eb5ade76](https://github.com/leon-ai/leon/commit/eb5ade76844dd14f5d5a5c5eeb434eed70fe62f4) 
 - train skills resolvers and remap as per changes [82df0a3c](https://github.com/leon-ai/leon/commit/82df0a3c235fbd50ad0cfe12e23a51f777dcd658) 
 - achieve Cartesian training [a1e9011d](https://github.com/leon-ai/leon/commit/a1e9011d5db48ed8e9f49cef2d813ee7e2400ec2) 
 - introduce suggestions [dcddacca](https://github.com/leon-ai/leon/commit/dcddacca2956529de0aea8ff98e1e6f16104966a) 
 - communicate suggestions to the client [4b5a8835](https://github.com/leon-ai/leon/commit/4b5a883510fd4421a491f999cc21d8f7dd369a03) 
 - shared skills memory [795acc5b](https://github.com/leon-ai/leon/commit/795acc5bdd29e9a27d1cf3b4407453648d573973) 
 - support dynamic variables on skill NLU settings for logic type [10d10a16](https://github.com/leon-ai/leon/commit/10d10a1690cb65970932ee7230e3f324ec67dbce) 
 - tmp resolvers mapping [b1a332ba](https://github.com/leon-ai/leon/commit/b1a332bab6af8b74a8c58c07bac3ef3a1cebad89) 
 - start to map resolvers between the core and skills [e88495a9](https://github.com/leon-ai/leon/commit/e88495a9a94e86026fd0c7c4c44f3ff06edb2e80) 
 - train affirmation and denial resolver [993d52e8](https://github.com/leon-ai/leon/commit/993d52e8686f335039ff3d5e2a82c1a37efb1825) 
 - Python TCP server and Node.js TCP client for IPC (wip) [5970ec9e](https://github.com/leon-ai/leon/commit/5970ec9e8e4c2784c50e2ddc76b34b71aa4310e6) 
 - introduce spaCy for complete NER (wip) [caa86fc8](https://github.com/leon-ai/leon/commit/caa86fc8a6850b18f67ba7bedb423be693a88d17) 
 - slot filling (wip) [76547d94](https://github.com/leon-ai/leon/commit/76547d9411c32e0eb2ccfdac3a4901d2d2fb37f6) 
 - share data across domains [f4f9fff9](https://github.com/leon-ai/leon/commit/f4f9fff9783861be183990d7869973c7a30c8104) 
 - dynamic variable binding on NLG [0367b44f](https://github.com/leon-ai/leon/commit/0367b44f211c1629fffe6981a730f171707bf0c0) 
 - context and slot filling preparation (wip) [975b8ebc](https://github.com/leon-ai/leon/commit/975b8ebcf00db91b44dd067be6dde5c1bf32fff1) 
 - annotate entities on the fly + prepare for dialog skill type and cross-domains data [4107932d](https://github.com/leon-ai/leon/commit/4107932d000086188d6f44ef67b73cc322fc58e5) 
 - new NLP training [d8023308](https://github.com/leon-ai/leon/commit/d8023308d0ef1f3eede37f21f45daa2f893031b0) 
  
 - **server:**
   - trigger next action suggestions or current ones [244d08c0](https://github.com/leon-ai/leon/commit/244d08c0bd0fea315269f52ab899f9b7fe083f51) 
   - introduce main NLP model and resolvers NLP model [e37526d9](https://github.com/leon-ai/leon/commit/e37526d9056d858ebcf17b81f6714f47b67c77cb) 
   - change log emojis [843bc428](https://github.com/leon-ai/leon/commit/843bc428b8deb397e2d051a8e0bfaf1b82b459a2) 
   - provide nextAction even when no slot is set and clean up NLU object on context switch [8377c63d](https://github.com/leon-ai/leon/commit/8377c63db4e4e42ed929171cd8b9abdb13c44b2a) 
   - report full traceback from skills execution [b69b1fea](https://github.com/leon-ai/leon/commit/b69b1fea16250421bc7d5def1c973dd43e453071) 
   - support on-the-fly entity annotation for built-in entities [567b030c](https://github.com/leon-ai/leon/commit/567b030c4fcf8df266c39cca61a146fb33b9e0fc) 
   - save slots within conversation context [fce47cdb](https://github.com/leon-ai/leon/commit/fce47cdbd570993ac5cca2b4ff5bc97969df4e40) 
   - resolve resolvers tmp [ceea47ff](https://github.com/leon-ai/leon/commit/ceea47ff7dd536bfd3adf3cc355e90e3e94b1cbd) 
   - prepare the next action on non-slot-filled skills [0acb31a9](https://github.com/leon-ai/leon/commit/0acb31a9c61c1c094b29f3d0ff2647d625eab0be) 
   - add more affirmative utterance samples [870ab2e8](https://github.com/leon-ai/leon/commit/870ab2e87eba2c548d38dc90d30553e7fa380c1e) 
   - restart a skill with the original utterance saved in context [f4446ef1](https://github.com/leon-ai/leon/commit/f4446ef17796d38d0f98d5b7e889503622a1a998) 
   - clean up context if the action loop does not meet the expected items [035c9d52](https://github.com/leon-ai/leon/commit/035c9d5240472ac19a84ae8c1a87844fa0d0af5d) 
   - add handsigns custom entity [1529c720](https://github.com/leon-ai/leon/commit/1529c72039092c7b8f37304d6064e04f2dc7b795) 
   - reprocess NLU in case of slot filling interruption [9e242d77](https://github.com/leon-ai/leon/commit/9e242d77d32109e9355eec422790a5a66fd18f9c) 
   - handle action loop when slots have all been filled at once [f8830502](https://github.com/leon-ai/leon/commit/f88305020a5bc79056b7ff9c1a31f8d3c3a7cdce) 
   - break the action loop from the skill [27dc801c](https://github.com/leon-ai/leon/commit/27dc801cf53de5af3d54b95f42d2b9e627090867) 
   - stop action loop from skill to core [99681e25](https://github.com/leon-ai/leon/commit/99681e257795a18361be379b93244088401f640b) 
   - introduce basic concept of action loop [c5b38400](https://github.com/leon-ai/leon/commit/c5b38400821e5bc5edc4402d007f815f24319d44) 
   - prepare action loop feature [19e1aa22](https://github.com/leon-ai/leon/commit/19e1aa22f6e989e90eb745e3a7b7ccb8ff5adbfa) 
   - add current utterance entities to differentiate from the whole context [8b56a185](https://github.com/leon-ai/leon/commit/8b56a1850c9d76e335f1bad1b4395d73ddc5ea19) 
   - when a context is activated, pick up the most probable classification [8e186879](https://github.com/leon-ai/leon/commit/8e1868798c8750c19b1719a44dc6fb8bca68b250) 
   - persist entities into contexts [87575773](https://github.com/leon-ai/leon/commit/875757739f6701f54805eeff2c7c350cff36c4ac) 
   - forward slots to skill + add original utterance [68e40f65](https://github.com/leon-ai/leon/commit/68e40f65df0d1fe29ccad991868a2408c6e1015e) 
   - handle case when all slots have been filled in one utterance [22e9234b](https://github.com/leon-ai/leon/commit/22e9234b3d2c97e83eaafaeeb5aa9d27c351c95a) 
   - trigger next action once all slots have been filled [9b870010](https://github.com/leon-ai/leon/commit/9b870010dd929bc1aed6d87696f1cc4e9f177c0b) 
   - complete slot filling before triggering the next action [9124687e](https://github.com/leon-ai/leon/commit/9124687eb0e17295a30f860752ee622ba44d1440) 
   - from modules to skills with type at the actions level [77ebaf4a](https://github.com/leon-ai/leon/commit/77ebaf4a9c78b2e471d39872e361ea05b163580d) 
   - verify if all slots are filled [e27c1b9c](https://github.com/leon-ai/leon/commit/e27c1b9c8f5c2f668f464f152ad227d65ba5ef6b) 
   - context and slot filling, keep context and await for entities [25adf406](https://github.com/leon-ai/leon/commit/25adf406c810e48b1277105dd6c269a2ed601d28) 
   - unstack oldest context [1ece25a4](https://github.com/leon-ai/leon/commit/1ece25a497acc9f9876fe158ace5da38beec31e6) 
   - context setup with slot for each conversation (wip) [8257eb87](https://github.com/leon-ai/leon/commit/8257eb8792c9f4fc90bcc1b393d3fddf8ff541dc) 
   - resolve slots from slot filling [960a6dc7](https://github.com/leon-ai/leon/commit/960a6dc71c2efb50ad6a8448d447ebd79c559c41) 
   - pickup questions for slot filling [3bbc2f8a](https://github.com/leon-ai/leon/commit/3bbc2f8a254d10f0c37cdb7abf016b3e418f594a) 
   - main slots structure (wip) [1d9b1809](https://github.com/leon-ai/leon/commit/1d9b18093b6e042ae49f557149a7822b4420cdb8) 
   - introduce resolvers for slot filling (wip) [334bf393](https://github.com/leon-ai/leon/commit/334bf393f2c43edd326d9de2e93c037ffeebeab5) 
   - slot filling PoC (tmp wip) [95bfcfe4](https://github.com/leon-ai/leon/commit/95bfcfe422f21a2946e50031a3623675dfe81b9d) 
   - slot filling (wip) [969a83e6](https://github.com/leon-ai/leon/commit/969a83e6081de20ec5e2bdd0329a21a3fe448f13) 
   - trigger unsupported language [1845eed7](https://github.com/leon-ai/leon/commit/1845eed71dadd5f693d76abd7633864014bf8af1) 
   - context (wip) [d1c2a11d](https://github.com/leon-ai/leon/commit/d1c2a11d8284ca4e1d4563b871c50c006e8ef8a0) 
   - context (wip) [a9a43ac4](https://github.com/leon-ai/leon/commit/a9a43ac478c46f3832d2af49c287bb574a70cc14) 
   - differenciate cities from countries for location entities [bf9bf231](https://github.com/leon-ai/leon/commit/bf9bf231f714e1edc1417e43af12fa54c00ba064) 
   - auto restart the TCP server when language is switching [9be7c700](https://github.com/leon-ai/leon/commit/9be7c700767672ac6e0c875d3b5ae7fa6414e4fa) 
   - support multi languages on TCP server [a808742c](https://github.com/leon-ai/leon/commit/a808742c927d45c18df45af133e67c98d4a0415a) 
   - add auto reconnect on TCP client [cbe89ed6](https://github.com/leon-ai/leon/commit/cbe89ed6ccfd727356eb34078a8a4348b2fd696f) 
   - make TCP client global [006e9fb0](https://github.com/leon-ai/leon/commit/006e9fb01148c2107f6acc6a562ace4809da92be) 
   - fully implement low-level networking for IPC [8acb82da](https://github.com/leon-ai/leon/commit/8acb82da9bacdb9b7952c4a4d130d094e07def5e) 
   - more accurate NLG [d5577b1e](https://github.com/leon-ai/leon/commit/d5577b1ef5cf1b8b4a924636ba4425b8b4ae133d) 
   - unknown_answers fallback on dialog type [28efe6e7](https://github.com/leon-ai/leon/commit/28efe6e7d542f19bf12ddede1815f7fa8cf01036) 
   - deep data mapping on enum NER [3ca48265](https://github.com/leon-ai/leon/commit/3ca48265e7115c8e0f02c65ba92d90412325ad76) 
   - NLG and entities mapping [8f2f935b](https://github.com/leon-ai/leon/commit/8f2f935b949ceb965941460d4ff1ed0084b72442) 
   - bootstrap skill structure [fe90c68e](https://github.com/leon-ai/leon/commit/fe90c68ea0e9b0e857b62aa9f3b0a42ba1ffed6b) 
   - on-the-fly language switching [f24513a2](https://github.com/leon-ai/leon/commit/f24513a22395d1903e485883f4813cdceccdbd18) 
   - new NLP containers [34b2aa56](https://github.com/leon-ai/leon/commit/34b2aa5655e55284d59db4569960c49965a0483c) 
   - (WIP) NLU refactoring [ca3f5f42](https://github.com/leon-ai/leon/commit/ca3f5f42da26eb634e10b56e9b84bd45b5543024) 
   - add skills domains [cf2a28aa](https://github.com/leon-ai/leon/commit/cf2a28aac2d936cc15e6aa9aa13747015d952053) 
 - **skill/akinator:**
   - finish up [79e7df02](https://github.com/leon-ai/leon/commit/79e7df022f7daedf43db7f892e049a31924ce985) 
   - finished main business logic [76cae42f](https://github.com/leon-ai/leon/commit/76cae42fdeac0edcd3ebd6aa7718728617687b1b) 
   - backbone [02a2f714](https://github.com/leon-ai/leon/commit/02a2f71470bb4c0c6ca04526e89461d863d17145) 
- **skill/birthday:**
  remove birthday skill [be0b345d](https://github.com/leon-ai/leon/commit/be0b345d3f7fea562548e3fbed62b65c32eff4c0) 
- **skill/color:**
  introduce color skill [ce00989b](https://github.com/leon-ai/leon/commit/ce00989b01f65c5cbb5a2e13f454207c1ba7741c) 
- **skill/guess_the_number:**
  introduce the Guess the Number skill [fba80966](https://github.com/leon-ai/leon/commit/fba80966c937a32182e48670c47358babb539d64) 
- **skill/introduction:**
   - add one utterance sample [af0fdd1e](https://github.com/leon-ai/leon/commit/af0fdd1e18975bf8b60abb2957ddf79831281817) 
   - ask about owner info if necessary [c5cc9bdd](https://github.com/leon-ai/leon/commit/c5cc9bdd52afaaa710f9476d1e9918f3d168e243) 
- **skill/mbti:**
   - complete form resolver [aad9f3f1](https://github.com/leon-ai/leon/commit/aad9f3f1ef61499d438ea40c9d2d95764667678d) 
   - finish business logic [99a3f103](https://github.com/leon-ai/leon/commit/99a3f103e00b5a58745ee851d2fa95c61871f75a) 
   - questions mapping [ae4f69f7](https://github.com/leon-ai/leon/commit/ae4f69f7c7189ff75e004f68c9a2a8b6bb37b6bd) 
   - complete questionnaire [7f1f8871](https://github.com/leon-ai/leon/commit/7f1f8871598746c5475b24e086ea6e581f2a988e) 
   - main logic backbone [33109a4c](https://github.com/leon-ai/leon/commit/33109a4c8b5df82e7b98e48e66f8d53f0cc114fb) 
   - main NLU structure [skip ci] [86d5040a](https://github.com/leon-ai/leon/commit/86d5040a7dc2006036c7e67a2cf54a4c992e64aa) 
- **skill/rochambeau:**
   - add start answers [192dd0a8](https://github.com/leon-ai/leon/commit/192dd0a87ab5dc025bb90b20b187e36a58be54ea) 
   - introduce paper scissors rock [57370470](https://github.com/leon-ai/leon/commit/573704706c843d870f2498146bc3cd659bab4f06) 
   - init [7f5e30ac](https://github.com/leon-ai/leon/commit/7f5e30ac82f2a2d7579e361229a4044348915867) 
- **web app:**
   - join us on Discord [141c89ec](https://github.com/leon-ai/leon/commit/141c89ecbfd329a8e63d5a603d0ae6b42f9abf38) 
   - wait for TCP client to be connected first [bc228a68](https://github.com/leon-ai/leon/commit/bc228a68600c07871c489d6624bbc837971079a6) 
  ### Bug Fixes
- check script with new intent-object format [fdf0a389](https://github.com/leon-ai/leon/commit/fdf0a389b76caba5dd47996a43a34c0c7821c70a) 
- check new resolvers paths [cfd8f7cb](https://github.com/leon-ai/leon/commit/cfd8f7cbe5e8fd9ce3d1659c725d7af261db8d71) 
- use ports.ubuntu.com mirror for the offline TTS [skip ci] [3dd90396](https://github.com/leon-ai/leon/commit/3dd9039678820fceb7ccbb1c96358c8d2f188ede) 
- set skill config only when a bridge is set [7513aa7d](https://github.com/leon-ai/leon/commit/7513aa7d20fee1fe9ca5442a7909d22fd1c3b39e) 
- only set skill config when it is a logic type [9ce9a8bc](https://github.com/leon-ai/leon/commit/9ce9a8bc4fe0864730a08d8e9a436982f1365aa5) 
  
- **docker:**
   - usage of Ubuntu base image with pyenv and nvm (#408) [f507f6f7](https://github.com/leon-ai/leon/commit/f507f6f7e499f56768b3e624164cbcd58193b153) 
   - check should not allocate a pseudo-TTY (#359) [4372b45f](https://github.com/leon-ai/leon/commit/4372b45fc605893d4130cf7110dd87519b934345) 
- **server:**
   - make leon handle multiple socket.io-client instances [6e7c0aac](https://github.com/leon-ai/leon/commit/6e7c0aac57008b152b45f1b0f3886ae38777467b) 
   - fallback on global resolver during resolver classification [ec77dd0f](https://github.com/leon-ai/leon/commit/ec77dd0f02a8ae94fb3f02c7b7847b5509d71406) 
   - make use of current entities to match global entities [a8d82050](https://github.com/leon-ai/leon/commit/a8d82050c86b5c24c4c898c06e5ffc3882524c0b) 
   - multiple slots filling [2ac1bc63](https://github.com/leon-ai/leon/commit/2ac1bc63ccd11757d586adfb2e75ce04e3ffbcb5) 
   - context switching on action loop [6712ae55](https://github.com/leon-ai/leon/commit/6712ae5539ef44ed33e360cfcad71c760c4b13b1) 
   - check one-shot slot filling case causing infinite loop [782a3aaa](https://github.com/leon-ai/leon/commit/782a3aaa0a07dda667557bc84db906b3fa9b237c) 
   - clean up active context after all slots have been filled [faabc2c7](https://github.com/leon-ai/leon/commit/faabc2c7b0992fcea035eedf66103d84b101e1a7) 
   - correctly extract all spaCy entities [6aa60bfb](https://github.com/leon-ai/leon/commit/6aa60bfbd8c72e678fe3faf5e7f9dbd37dfd209f) 
   - intent not found [8280c658](https://github.com/leon-ai/leon/commit/8280c65897dba0fe470a3589d151b391c51e344e) 
   - fallback due to modules to skills refactoring [ef0c54b2](https://github.com/leon-ai/leon/commit/ef0c54b22667ef2bd1d2c07003f6b4beb5fa25c0) 
   - NER due to modules to skills refactoring [e4d3904c](https://github.com/leon-ai/leon/commit/e4d3904ceeb2a3ee2c0187a1817331fac916e1a7) 
   - **skill/akinator:**
  remove direct end on guess action [f6461f73](https://github.com/leon-ai/leon/commit/f6461f733b4a5d944dfa4a987dd1109628c6cbca) 
   - **skill/color:**
  more appropriate answer [cb18ed63](https://github.com/leon-ai/leon/commit/cb18ed6397cb0e0ad8fbea30c57d7d40137441ee) 
   - **skill/rochambeau:**
  final logic [0ebc0518](https://github.com/leon-ai/leon/commit/0ebc0518e61b899c35dd13df65a43f69399e784d) 
  ### Performance Improvements
 - check Pipfile instead of Pipfile.lock to judge whether Python packages must be installed [afdb71f7](https://github.com/leon-ai/leon/commit/afdb71f766f2956c5cb4a5e0be9025340d1a89db) 
  
### Documentation Changes
 - change newsletter link [4bf2a9af](https://github.com/leon-ai/leon/commit/4bf2a9af963f75aeff96f4a43da8ec1024ac583a) 
 - README - Edited sentence for clarity (#389) [e83a1c42](https://github.com/leon-ai/leon/commit/e83a1c4230897e8b63251ef86225cf773148c38e) 
 - edit newsletter link [fa558a44](https://github.com/leon-ai/leon/commit/fa558a447ade4071f352d56f14602690ed90f521) 
 - update sponsor [skip ci] [f30ddb6b](https://github.com/leon-ai/leon/commit/f30ddb6be5f531df2b0042be0ed5ffbe79f73b07) 
 - remove sponsor [skip ci] [5dbc010f](https://github.com/leon-ai/leon/commit/5dbc010fa643279a24081f3148022e2211af63f4) 
 - remove sponsor [skip ci] [f36dd20f](https://github.com/leon-ai/leon/commit/f36dd20f822cd33c9e8a03efc2849c8d8d1fc75e) 
 - remove sponsor [skip ci] [5ee57ddf](https://github.com/leon-ai/leon/commit/5ee57ddf2a9f7817ec35b2e70d49e5bb422d8f78) 
 - add @ant-media sponsor [skip ci] [b47cbc3a](https://github.com/leon-ai/leon/commit/b47cbc3a5ecb6591f7abb4f62feae8102b9a6468) 
 - add long dev notice to README [skip ci] [499be77d](https://github.com/leon-ai/leon/commit/499be77d509231b853f591e27f726381da5a50d8) 
 - move sponsor to new section [skip ci] [8825d687](https://github.com/leon-ai/leon/commit/8825d6877c19d86495e89a858b859b7ab1f9ae37) 
 - change Twitter handle [skip ci] [c1afc11c](https://github.com/leon-ai/leon/commit/c1afc11cdb283526540d0fecdf83efddf3f3a9f7) 
 - remove sponsor [skip ci] [99b401a6](https://github.com/leon-ai/leon/commit/99b401a668a6fb248e33c22782940402be7c9b17) 
 - add new sponsor self-hosted img [skip ci] [238d928c](https://github.com/leon-ai/leon/commit/238d928cace13d4ecd174ca14b136967d8845e0f) 
 - remove new sponsor link (broken) [skip ci] [254f2848](https://github.com/leon-ai/leon/commit/254f2848aab622b79cce16d10c58d53ff6db9a8f) 
 - in GitHub BUG.md from modules to skills [4a5480a3](https://github.com/leon-ai/leon/commit/4a5480a3ccc54ee34d42f6edcec2a40224dee7ed) 
 - change @FluxIndustries sponsorship [skip ci] [1a118b71](https://github.com/leon-ai/leon/commit/1a118b718e5d4ade123756ac94758a01c50b12ae) 
 - add @FluxIndustries sponsor [skip ci] [9a604d7c](https://github.com/leon-ai/leon/commit/9a604d7ccc0c6aaec257299078141dd0c3077933) 
 - new #LeonAI link [skip ci] [a0107d62](https://github.com/leon-ai/leon/commit/a0107d629473f7fd057d367926e83822d46f1227) 
 - changelog new version diff link fix [skip ci] [e14c2498](https://github.com/leon-ai/leon/commit/e14c249826db92af7b85422e566be6aa834a7fb7)

# [1.0.0-beta.6](https://github.com/leon-ai/leon/compare/v1.0.0-beta.5...v1.0.0-beta.6) (2022-02-07) / Leon Over HTTP + Making Friends with Coqui STT
### Features
 - simple coqui-ai stt integration [86a4816b](https://github.com/leon-ai/leon/commit/86a4816b777fee8ec9c89648c5866a75de56c017) 
 - HTTP API key generator [d10a7fa7](https://github.com/leon-ai/leon/commit/d10a7fa7880a0bf2fb1cae7904d1ef4257f05257) 
 - avoid unnecessary routes generation  
  
 - **server:**
   - make Coqui STT the default STT solution [70399187](https://github.com/leon-ai/leon/commit/7039918760c0ef7ba93bf45820e3cae774c42d8c) 
     - add HTTP API key middleware [cdf41499](https://github.com/leon-ai/leon/commit/cdf4149939cbe3f3ae81039957dba3377a78f5a6) 
     - expose queries over HTTP [b6428d03](https://github.com/leon-ai/leon/commit/b6428d038452619f1682c863892cd8f376efca84) 
     - add timeout action over HTTP [115f9c16](https://github.com/leon-ai/leon/commit/115f9c164559d761625cc6f362749f7d2417d300) 
     - handle built-in and trim entities over HTTP + add "disabled" HTTP API action option [82fb967a](https://github.com/leon-ai/leon/commit/82fb967af8f49421e3b2474184da3d34fb17294f) 
     - execute modules over HTTP [2e5b2c59](https://github.com/leon-ai/leon/commit/2e5b2c59da0bafe3acd966773c6fac3611b3bd0c) 
     - generate Fastify routes on the file to expose packages over HTTP [5b41713a](https://github.com/leon-ai/leon/commit/5b41713a68ee628e695212dbebc88f6b9a94b461) 
  ### Bug Fixes
 - do not ask to regenerate the HTTP API key if this one isn't available yet [d265377a](https://github.com/leon-ai/leon/commit/d265377a43fd4506cf12db46f261b891f2054ed2) 
 - Python deps tree check [c6c01291](https://github.com/leon-ai/leon/commit/c6c012915824227efdf0c50df6a8f1cd8d70ed42) 
 - hotword offline (#342) [f563d01d](https://github.com/leon-ai/leon/commit/f563d01d077499c836e94c86f85cedc2ad4d56e6) 
 - addressed comments by @JRMeyer [b1c6f5c8](https://github.com/leon-ai/leon/commit/b1c6f5c883103d57d4fe566af640fc3ac5ce713d) 
 - allow to detect STT offline capabilities [04d62288](https://github.com/leon-ai/leon/commit/04d622884165e0bde65785569a659f59cf9e8582) 
 - Amazon Polly is always configured on check script due to new structure [e6246d1f](https://github.com/leon-ai/leon/commit/e6246d1f8f9ec15a4ebe9600764afffbaa7e62d9) 
  
### Performance Improvements
 - check if Python deps tree has been updated before going through deps install [2d0b0f13](https://github.com/leon-ai/leon/commit/2d0b0f1365d8e4d6eadf9f7cc0a16b7b4b4306f4)

# [1.0.0-beta.5](https://github.com/leon-ai/leon/compare/v1.0.0-beta.4...v1.0.0-beta.5) (2021-12-28) / Refocus

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

# [1.0.0-beta.4](https://github.com/leon-ai/leon/compare/1.0.0-beta.2...v1.0.0-beta.4) (2021-05-01) / Getting Rid of Dust

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
