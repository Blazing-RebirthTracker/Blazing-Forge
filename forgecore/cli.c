#include "fc.h"
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc < 6 || strcmp(argv[1], "build")) { fprintf(stderr, "usage: forgecore build <base> <mod> <BlazingEngine.json> <out> [--summon off|on]\n"); return 2; }
    FcBuild b = {argv[2], argv[3], argv[4], argv[5], -1, 9, NULL, NULL};
    for (int i = 6; i + 1 < argc; i++) if (!strcmp(argv[i], "--summon")) b.summon = !strcmp(argv[i + 1], "on");
    if (fc_build(&b)) { fprintf(stderr, "FAILED: %s\n", fc_err); return 1; }
    fprintf(stderr, "build ok\n"); return 0;
}
