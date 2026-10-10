#!/bin/sh
# Builds BlazingForge.dylib (patch installer + on-device mod pack builder).
# Needs clang, lld (as ld64.lld on PATH) and an iPhoneOS SDK (e.g. theos/sdks iPhoneOS14.5.sdk).
SDK=${SDK:-$HOME/theos/sdks/iPhoneOS14.5.sdk}
FC=../forgecore
clang -target arm64-apple-ios12.2 -isysroot "$SDK" -fobjc-arc -O2 -fuse-ld=lld -dynamiclib \
  -install_name @executable_path/Frameworks/BlazingForge.dylib -framework Foundation -framework UIKit -lz \
  -Wl,-adhoc_codesign -o BlazingForge.dylib BlazingForge.m \
  $FC/fc_util.c $FC/fc_json.c $FC/fc_obf.c $FC/fc_ufs.c $FC/fc_sf.c $FC/fc_img.c $FC/fc_build.c $FC/fc_summon.c \
  $FC/vendor/lz4.c $FC/vendor/lz4hc.c
# Hook it in as a dependency of the loader (pip install lief):
# python -c "import lief;b=lief.MachO.parse('BlazingLoader.dylib').at(0);b.add_library('@executable_path/Frameworks/BlazingForge.dylib');b.write('BlazingLoader.dylib')"
