# Changelog

## [1.3.0](https://github.com/DavidAEriksson/deltaview/compare/v1.2.0...v1.3.0) (2026-10-23)


### Features

* **overlay:** keyboard shortcuts and a Next undecided button ([8e666aa](https://github.com/DavidAEriksson/deltaview/commit/8e666aa5f6f6fd13bfa546b94dd64d1fcc937691))
* **overlay:** line numbers and word-level highlights in the diff view ([9bf4034](https://github.com/DavidAEriksson/deltaview/commit/9bf40341722159fc060202ee4c41dd2b68aa0084))
* **overlay:** outline every selector match, dim outlines for extra instances ([0b434e5](https://github.com/DavidAEriksson/deltaview/commit/0b434e524f97a6d27cebb6a67ff1b97b38632b3a))

## [1.2.0](https://github.com/DavidAEriksson/deltaview/compare/v1.1.0...v1.2.0) (2026-10-23)


### Features

* **github:** list approvals in the review body instead of inline comments ([ef1689a](https://github.com/DavidAEriksson/deltaview/commit/ef1689ae252b2cafa480baa6aedae62ce4d451d6))
* **overlay:** confirm Finish when items are undecided ([c79214a](https://github.com/DavidAEriksson/deltaview/commit/c79214a45ae539fb8a7886d3f527635c96d2f006))


### Bug Fixes

* **github:** note in the review when the PR head moved during review ([7e1c8ca](https://github.com/DavidAEriksson/deltaview/commit/7e1c8caf8e18f362334544d60989ea706fe444f0))
* **proxy:** accept self-signed certs from loopback https dev servers ([17875cc](https://github.com/DavidAEriksson/deltaview/commit/17875cc20270d5536edf3562271952ac00017cf7))
* **proxy:** support https dev servers ([bb320ee](https://github.com/DavidAEriksson/deltaview/commit/bb320ee5220cec28c9e0b554656b08dde6e99667))

## [1.1.0](https://github.com/DavidAEriksson/deltaview/compare/v1.0.0...v1.1.0) (2026-10-22)


### Features

* **overlay:** decision colors, reset, compact chips, movable toolbar, close panel ([c6c969d](https://github.com/DavidAEriksson/deltaview/commit/c6c969d0382c71a1e7918eba3df580632718a4f4))

## 1.0.0 (2026-10-22)


### Features

* /deltaview skill and plugin packaging ([d5dd262](https://github.com/DavidAEriksson/deltaview/commit/d5dd262af56d25fe4d858b7bf1c77952b55488c9))
* diff parser and init CLI ([d31e39b](https://github.com/DavidAEriksson/deltaview/commit/d31e39b9f33622986f9bf672f47372a1358e05fc))
* env-var detection, resume lookup, manifest CLI ([d333cff](https://github.com/DavidAEriksson/deltaview/commit/d333cffac65ec7e579cd11b57319834166609af8))
* GitHub review mapping and markdown rendering ([a62abb3](https://github.com/DavidAEriksson/deltaview/commit/a62abb37d93bc666db9a0d87df5c703654ab56e2))
* injecting proxy, decision API, serve CLI ([dce32ac](https://github.com/DavidAEriksson/deltaview/commit/dce32ac5837c109a6aee8e193f13115f75c3e8c3))
* manifest model with coverage validation ([8445e91](https://github.com/DavidAEriksson/deltaview/commit/8445e91ca8b898116d2d96ed75f1388c44a0ed02))
* overlay close button and Esc to close, keep chips on screen ([a9b3292](https://github.com/DavidAEriksson/deltaview/commit/a9b32925d525ae245eb676aa62c9d8d29b2c4cf4))
* overlay UI ([ce9145e](https://github.com/DavidAEriksson/deltaview/commit/ce9145e7816c8ff283b2274167dc985628312592))


### Bug Fixes

* don't resume a manifest with no items ([7400320](https://github.com/DavidAEriksson/deltaview/commit/74003208d5146afad93232bf5d0e0a3eef4f45cc))
* emit empty hunk for hunkless file changes; disable git path quoting ([c5d2446](https://github.com/DavidAEriksson/deltaview/commit/c5d2446cb51af662eff8b5b1eff9bb435d65a811))
* ignore EPIPE on gh stdin so serve doesn't crash ([5ed7ecc](https://github.com/DavidAEriksson/deltaview/commit/5ed7ecccca2b0c467e86ad070e1cadede4caeca6))
* overlay hash redirect loop, DELTAVIEW/&lt;ref&gt; chips that don't cover the app, keep keys from app hotkeys ([1f3445e](https://github.com/DavidAEriksson/deltaview/commit/1f3445e01bb2097bc756b214f03ae5327e603e88))
* overlay SPA navigation, throttle, compact bar ([d581bcf](https://github.com/DavidAEriksson/deltaview/commit/d581bcf11c9cb0fb74be7a0866344b86df077d6d))
* proxy CSRF guard, block decisions during finish, map Origin/Referer ([7b10940](https://github.com/DavidAEriksson/deltaview/commit/7b109403605c86a71cb512b32cfce765e6412176))
* realistic deleted-file fixture ([d2d1df8](https://github.com/DavidAEriksson/deltaview/commit/d2d1df885d960a8306738bc4ea1238e5e8febae9))
* resume only exact ref, reject duplicate item ids ([f39a7e0](https://github.com/DavidAEriksson/deltaview/commit/f39a7e00f1c24f3103cddcdc80e49aabed46cf2a))
* serve on target hostname, guard concurrent finish ([85a5615](https://github.com/DavidAEriksson/deltaview/commit/85a561578d606dcdce6ed7daa6d55e5bc7b924e2))
* silence git stderr for missing env example files ([364b23d](https://github.com/DavidAEriksson/deltaview/commit/364b23d09a47422afda29e4a92ec94918030831f))
* test script works on Node 22 (no dir arg) ([09fb799](https://github.com/DavidAEriksson/deltaview/commit/09fb799cf647428787892edef18637e19a216092))
