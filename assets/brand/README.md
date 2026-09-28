# GRAILSHOT brand assets

Palette: charcoal, warm ivory and electric yellow. Generated raster assets use the built-in ImageGen tool; the exact prompts are stored beside them.

- `grailshot-x-banner-1500x500.jpg`: 3:1 X header ready to upload; left side leaves room for the profile avatar.
- `grailshot-x-banner-master.png`: full-resolution banner source; see `banner-prompt.txt`.
- `grailshot-avatar-1x1.png`: square, text-only social avatar; see `avatar-prompt.txt`.
- `grailshot-logo-master.png`: transparent horizontal logo source; see `logo-prompt.txt`.
- `grailshot-pack-v6-master.png`: realistic sealed foil pack using the approved logo; see `pack-v6-prompt.txt`.

The site serves `public/brand/grailshot-wordmark-v5.webp`, responsive `grailshot-pack-v6-360.webp` / `grailshot-pack-v6-720.webp`, and the vector `grailshot-mark-v5.svg`. The pack has genuine alpha transparency; its two WebP copies are 35 KB and 116 KB. Master artwork is excluded from Docker builds and is not loaded on the website. `scripts/build-brand.py` rebuilds the legacy vector pack, current mark and local font subsets; it does not regenerate the ImageGen artwork.
