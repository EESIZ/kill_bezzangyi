# Attribution and fork baseline

Kill_bezzangyi is derived from [Leonxlnx/unlazy](https://github.com/Leonxlnx/unlazy).

- Upstream baseline: `16671491f6679ad9378f52604d3bc2415b4120c7` (source package version 2.1.0).
- Original copyright: Copyright (c) 2026 Leonxlnx.
- Fork modifications: Copyright (c) 2026 EESIZ.
- License: MIT. The original copyright and permission notice are preserved in [LICENSE](LICENSE).
- Fork version: 0.1.0, a separate version sequence from upstream.

The initial fork changes project identity, skill invocation metadata, README, and project development documentation. Inherited verification behavior is retained. Upstream history remains in Git and CHANGELOG.md.

The `.unlazy/` state paths, `UNLAZY_*` environment variables, and existing hook/approval identifiers remain inherited compatibility identifiers. Their migration requires a separate design and compatibility review. This repository does not install a hook or modify another installed skill by itself.

PR #33's shared-check optimization is not part of this baseline.
