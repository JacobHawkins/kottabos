# Character artwork and credits

The character sprite sheet was supplied by the project owner on September 20,
2026, from the [Universal LPC Spritesheet Generator](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/).
Kottabos includes the supplied PNG unchanged. The game selects and animates
frames at runtime; it does not redraw or recolor the source image.

## Sprite layout

`character-spritesheet.png` is 832×3456 pixels: 13 columns and 54 rows of 64×64
cells. Its SHA-256 is
`52bed38705909be69a549ff7f535406c3b169255cea08ad248ea48173fde1b0f`.
Rows, columns and Phaser frame numbers below are zero-based.

| Direction | Walk row / frames | Idle row / frames |
| --- | --- | --- |
| Up | 8 / 105–112 | 22 / 286, 287 |
| Left | 9 / 118–125 | 23 / 299, 300 |
| Down | 10 / 131–138 | 24 / 312, 313 |
| Right | 11 / 144–151 | 25 / 325, 326 |

Walking loops columns 1–8 at 8 FPS. Idle uses the `[0, 0, 1]` column sequence at
2 FPS. Falling uses row 20, columns 0–5 (frames 260–265), once at 8 FPS. All other
sheet animations are unused. These mappings were verified against the supplied
pixels and the generator's
[animation constants](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/82283ac096a760c46b22336df3fc2a23f43e3fda/sources/state/constants.ts).
Sprite feet are anchored at cell y=62, rendered at 75% size, and use nearest
texture filtering. Colored ground markers and badges identify each player
without recoloring the artwork.

## Artwork attribution

Character art is by the Universal LPC contributors. Their attribution notices,
authors, license options and original-source URLs are preserved in
[character-credits.csv](character-credits.csv).

The supplied PNG has no embedded credits or saved generator selections, and a
matching exported credits file was not supplied. We therefore include the
generator's complete credits catalog, an option explicitly supported by its
[attribution instructions](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/82283ac096a760c46b22336df3fc2a23f43e3fda/README.md#licensing-and-attribution-credits).
The catalog includes artwork beyond this character. It is not a claim that every
catalog entry appears in the supplied sheet, and we do not infer selected layers
or a single license from the PNG. A future character-specific export can replace
the full catalog once the original selections are available.

## Catalog provenance

- Source repository: [LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator)
- Upstream revision: `82283ac096a760c46b22336df3fc2a23f43e3fda`
- Original file: [CREDITS.csv](https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/82283ac096a760c46b22336df3fc2a23f43e3fda/CREDITS.csv)
- Retrieved: September 20, 2026
- Local copy: `character-credits.csv`, unchanged apart from its filename
- Size: 3,987,290 bytes; 13,915 artwork entries
- SHA-256: `9bc3c6fc660946a8f36cefe8df8196884ac0309869cdcf3a8741f40577eb8c50`
- Git blob SHA-1: `726f42430bb210b68700909fca63d47e0c3c70f9`, verified against upstream

## License references

The CSV's `licenses`, `notes` and `urls` columns retain the terms and attribution
information recorded for each upstream asset. These are the generator's common
license references; the applicable asset entry and its original source identify
its available license options and versions:

- [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- [OGA BY 3.0](https://static.opengameart.org/OGA-BY-3.0.txt)
- [GPL 2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) and [GPL 3.0](https://www.gnu.org/licenses/gpl-3.0.html)

Artwork retains its applicable upstream license terms. These notices do not
relicense Kottabos application code. Preserve the credits and source/license
links when redistributing the artwork, and retain modification notices if future
versions alter it. The game provides a visible credits link so players can access
the catalog. The catalog is downloaded only when that link is followed; it is not
parsed or fetched for character rendering.
