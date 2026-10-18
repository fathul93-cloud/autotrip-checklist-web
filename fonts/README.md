Roboto (Apache 2.0, lihat Roboto_LICENSE.txt) dari Flutter SDK `bin/cache/artifacts/material_fonts`, dipangkas ke huruf
Latin + Latin Extended agar unduhan website kecil:

    pyftsubset Roboto-X.ttf --unicodes="U+0020-007E,U+00A0-024F,U+2010-2027,U+2030-205E,U+20AC,U+2122,U+2190-2193,U+2212" --layout-features='*'

Medium & Bold dimuat oleh lib/web/peramban_web.dart (muatFont) ke family "Roboto"; Regular sudah dipaketkan Flutter
(assets/fonts/fallback/Roboto-Regular.ttf). Tidak ada font dari Google Fonts.
