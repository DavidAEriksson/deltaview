# Changelog

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
