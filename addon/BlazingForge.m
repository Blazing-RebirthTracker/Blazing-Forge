// BlazingForge.dylib — installs Blazing Forge patch zips on launch, before the offline server starts.
// Drop BlazingForge-patch.zip (or BlazingForge-uninstall.zip) into Files > On My iPhone > Blazing:Rebirth.
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <CommonCrypto/CommonDigest.h>
#include <zlib.h>
#include "../forgecore/fc.h"

static NSString *gAlertTitle = nil;
static NSString *gAlertText = nil;
static NSMutableString *gLog = nil;

static NSString *Docs(void) { return [NSHomeDirectory() stringByAppendingPathComponent:@"Documents"]; }
static NSString *ForgeDir(void) { return [Docs() stringByAppendingPathComponent:@"BlazingForge"]; }

static void L(NSString *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    NSString *s = [[NSString alloc] initWithFormat:fmt arguments:ap];
    va_end(ap);
    if (!gLog) gLog = [NSMutableString string];
    [gLog appendFormat:@"[%@] %@\n", [NSDate date], s];
    NSLog(@"BLAZING_FORGE %@", s);
}

static void FlushLog(void) {
    if (!gLog.length) return;
    NSString *p = [ForgeDir() stringByAppendingPathComponent:@"forge.log"];
    [[NSFileManager defaultManager] createDirectoryAtPath:ForgeDir() withIntermediateDirectories:YES attributes:nil error:nil];
    NSFileHandle *h = [NSFileHandle fileHandleForWritingAtPath:p];
    if (!h) { [gLog writeToFile:p atomically:YES encoding:NSUTF8StringEncoding error:nil]; return; }
    [h seekToEndOfFile]; [h writeData:[gLog dataUsingEncoding:NSUTF8StringEncoding]]; [h closeFile];
}

static NSString *Sha256(NSData *d) {
    unsigned char md[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(d.bytes, (CC_LONG)d.length, md);
    NSMutableString *s = [NSMutableString stringWithCapacity:64];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [s appendFormat:@"%02x", md[i]];
    return s;
}

// ---------------------------------------------------------------- zip reading (stored + deflate)
static uint16_t U16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static uint32_t U32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

static NSDictionary<NSString *, NSData *> *ReadZip(NSData *zip, NSString **err) {
    const uint8_t *b = zip.bytes; size_t n = zip.length;
    if (n < 22) { *err = @"not a zip file"; return nil; }
    size_t e = n - 22; BOOL found = NO;
    for (size_t i = 0; i < 65557 && e > 0; i++, e--) { if (U32(b + e) == 0x06054b50) { found = YES; break; } }
    if (!found) { *err = @"zip end record not found"; return nil; }
    uint16_t count = U16(b + e + 10); uint32_t cdOff = U32(b + e + 16);
    NSMutableDictionary *out = [NSMutableDictionary dictionary];
    size_t q = cdOff;
    for (uint16_t k = 0; k < count; k++) {
        if (q + 46 > n || U32(b + q) != 0x02014b50) { *err = @"damaged zip directory"; return nil; }
        uint16_t method = U16(b + q + 10); uint32_t crc = U32(b + q + 16);
        uint32_t csize = U32(b + q + 20), usize = U32(b + q + 24);
        uint16_t nl = U16(b + q + 28), el = U16(b + q + 30), cl = U16(b + q + 32);
        uint32_t lho = U32(b + q + 42);
        NSString *name = [[NSString alloc] initWithBytes:b + q + 46 length:nl encoding:NSUTF8StringEncoding];
        q += 46 + nl + el + cl;
        if (!name || [name hasSuffix:@"/"]) continue;
        if (lho + 30 > n) { *err = @"damaged zip entry"; return nil; }
        size_t dataOff = lho + 30 + U16(b + lho + 26) + U16(b + lho + 28);
        if (dataOff + csize > n) { *err = @"truncated zip"; return nil; }
        NSMutableData *d;
        if (method == 0) {
            d = [NSMutableData dataWithBytes:b + dataOff length:csize];
        } else if (method == 8) {
            d = [NSMutableData dataWithLength:usize];
            z_stream zs; memset(&zs, 0, sizeof zs);
            zs.next_in = (Bytef *)(b + dataOff); zs.avail_in = csize;
            zs.next_out = d.mutableBytes; zs.avail_out = usize;
            if (inflateInit2(&zs, -15) != Z_OK) { *err = @"inflate init failed"; return nil; }
            int r = inflate(&zs, Z_FINISH); inflateEnd(&zs);
            if (r != Z_STREAM_END || zs.total_out != usize) { *err = [NSString stringWithFormat:@"could not unpack %@", name]; return nil; }
        } else { *err = [NSString stringWithFormat:@"unsupported compression in %@", name]; return nil; }
        if ((uint32_t)crc32(0, d.bytes, (uInt)d.length) != crc) { *err = [NSString stringWithFormat:@"%@ is damaged (CRC)", name]; return nil; }
        out[name] = d;
    }
    return out;
}

// ---------------------------------------------------------------- paths
static NSString *DataRoot(void) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *a = [Docs() stringByAppendingPathComponent:@"BlazingData"];
    NSString *b2 = [a stringByAppendingPathComponent:@"BlazingData"];
    if ([fm fileExistsAtPath:[a stringByAppendingPathComponent:@"blazing-data.json"]]) return a;
    if ([fm fileExistsAtPath:[b2 stringByAppendingPathComponent:@"blazing-data.json"]]) return b2;
    return nil;
}

static BOOL SafeRel(NSString *rel) {
    if (rel.length == 0 || [rel hasPrefix:@"/"]) return NO;
    for (NSString *c in [rel componentsSeparatedByString:@"/"]) if ([c isEqualToString:@".."] || c.length == 0) return NO;
    return YES;
}

// "BlazingData/x" -> dataRoot/x ; "BlazingEngine/x" -> Documents/BlazingEngine/x
static NSString *Target(NSString *rel, NSString *dataRoot) {
    if ([rel hasPrefix:@"BlazingData/"]) return [dataRoot stringByAppendingPathComponent:[rel substringFromIndex:12]];
    if ([rel hasPrefix:@"BlazingEngine/"]) return [Docs() stringByAppendingPathComponent:rel];
    return nil;
}

static BOOL PutFile(NSData *d, NSString *path, NSString **err) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSError *e = nil;
    if (![fm createDirectoryAtPath:[path stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:&e]) {
        *err = e.localizedDescription; return NO;
    }
    if (![d writeToFile:path options:NSDataWritingAtomic error:&e]) { *err = e.localizedDescription; return NO; }
    return YES;
}

// ---------------------------------------------------------------- install / uninstall
static NSString *InstalledPath(void) { return [ForgeDir() stringByAppendingPathComponent:@"installed.json"]; }

static BOOL Uninstall(NSString *dataRoot, NSString **msg) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSDictionary *inst = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:InstalledPath()] ?: [NSData data] options:0 error:nil];
    if (![inst isKindOfClass:[NSDictionary class]]) { *msg = @"No Forge patch is installed, so there was nothing to remove."; return YES; }
    NSString *origDir = [ForgeDir() stringByAppendingPathComponent:@"original"];
    NSString *err = nil; int restored = 0, removed = 0;
    for (NSString *rel in inst[@"replaced"]) {
        NSData *d = [NSData dataWithContentsOfFile:[origDir stringByAppendingPathComponent:rel]];
        NSString *t = Target(rel, dataRoot);
        if (!d || !t) { L(@"uninstall: missing original for %@", rel); continue; }
        if (!PutFile(d, t, &err)) { *msg = [NSString stringWithFormat:@"Could not restore %@: %@", rel, err]; return NO; }
        restored++;
    }
    for (NSString *rel in inst[@"created"]) {
        NSString *t = Target(rel, dataRoot);
        if (t && [fm removeItemAtPath:t error:nil]) removed++;
    }
    NSString *mods = [dataRoot stringByAppendingPathComponent:@"content-ios/mods"];
    [fm removeItemAtPath:mods error:nil];
    [fm removeItemAtPath:InstalledPath() error:nil];
    L(@"uninstalled: %d restored, %d removed", restored, removed);
    *msg = @"Custom units removed. The original game files are back.";
    return YES;
}

static BOOL Install(NSDictionary<NSString *, NSData *> *z, NSString *dataRoot, NSString **msg) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSDictionary *mf = [NSJSONSerialization JSONObjectWithData:z[@"forge-patch.json"] ?: [NSData data] options:0 error:nil];
    if (![mf isKindOfClass:[NSDictionary class]]) { *msg = @"This zip has no forge-patch.json, so it isn't a Blazing Forge patch."; return NO; }
    // data version check: the installed blazing-data.json must be the clean one this patch was built from, or a Forge build of it
    NSData *cur = [NSData dataWithContentsOfFile:[dataRoot stringByAppendingPathComponent:@"blazing-data.json"]];
    NSString *curSha = cur ? Sha256(cur) : @"";
    NSDictionary *curJson = cur ? [NSJSONSerialization JSONObjectWithData:cur options:0 error:nil] : nil;
    BOOL curIsForge = [curJson isKindOfClass:[NSDictionary class]] && curJson[@"forge"] != nil;
    if (![curSha isEqualToString:mf[@"baseDataSha256"]] && !curIsForge && ![fm fileExistsAtPath:InstalledPath()]) {
        *msg = [NSString stringWithFormat:@"This patch was made for game data %@…, but this iPhone has %@…. Rebuild the patch for this data version.",
                [mf[@"baseDataSha256"] substringToIndex:12], curSha.length >= 12 ? [curSha substringToIndex:12] : @"(none)"];
        return NO;
    }
    // verify every file against the manifest before touching anything
    NSDictionary *files = mf[@"files"];
    for (NSString *rel in files) {
        NSData *d = z[[@"install/" stringByAppendingString:rel]];
        if (!SafeRel(rel) || !Target(rel, dataRoot)) { *msg = [NSString stringWithFormat:@"Unsafe path in patch: %@", rel]; return NO; }
        if (!d || ![Sha256(d) isEqualToString:files[rel]]) { *msg = [NSString stringWithFormat:@"%@ is missing or damaged in the patch.", rel]; return NO; }
    }
    // keep the clean originals (shipped inside the patch) for uninstall
    NSString *origDir = [ForgeDir() stringByAppendingPathComponent:@"original"];
    NSMutableArray *replaced = [NSMutableArray array], *created = [NSMutableArray array];
    NSString *err = nil;
    for (NSString *name in z) {
        if (![name hasPrefix:@"original/"]) continue;
        NSString *rel = [name substringFromIndex:9];
        if (!SafeRel(rel)) continue;
        NSString *dst = [origDir stringByAppendingPathComponent:rel];
        if (![fm fileExistsAtPath:dst] && !PutFile(z[name], dst, &err)) { *msg = [NSString stringWithFormat:@"Could not save backup %@: %@", rel, err]; return NO; }
    }
    for (NSString *rel in files) {
        if ([fm fileExistsAtPath:[origDir stringByAppendingPathComponent:rel]]) [replaced addObject:rel]; else [created addObject:rel];
    }
    // previously created files that this patch no longer ships stay listed so uninstall still removes them
    NSDictionary *prev = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:InstalledPath()] ?: [NSData data] options:0 error:nil];
    if ([prev isKindOfClass:[NSDictionary class]]) for (NSString *rel in prev[@"created"]) if (![created containsObject:rel]) [created addObject:rel];
    // write installed.json first so a half-finished install can still be uninstalled
    NSDictionary *inst = @{@"replaced": replaced, @"created": created, @"units": mf[@"units"] ?: [NSArray array], @"patch": mf[@"patchId"] ?: @""};
    if (!PutFile([NSJSONSerialization dataWithJSONObject:inst options:NSJSONWritingPrettyPrinted error:nil], InstalledPath(), &err)) {
        *msg = [NSString stringWithFormat:@"Could not write installed.json: %@", err]; return NO;
    }
    int n = 0;
    for (NSString *rel in files) {
        if (!PutFile(z[[@"install/" stringByAppendingString:rel]], Target(rel, dataRoot), &err)) {
            *msg = [NSString stringWithFormat:@"Stopped at %@: %@. Drop BlazingForge-uninstall.zip in to undo.", rel, err]; return NO;
        }
        n++;
    }
    NSMutableArray *names = [NSMutableArray array];
    for (NSDictionary *u in mf[@"units"]) [names addObject:[NSString stringWithFormat:@"%@ — %@", u[@"name"], u[@"subtitle"]]];
    L(@"installed %d files, units: %@", n, names);
    *msg = [NSString stringWithFormat:@"Installed %lu custom unit(s):\n%@\n\nClaim them in the Present Box.", (unsigned long)names.count, [names componentsJoinedByString:@"\n"]];
    return YES;
}


// ---------------------------------------------------------------- on-device builder (forgecore)
// A mod pack is a zip with forge-mod.json at its root (or under one folder) plus units/, banners/, summon/,
// gifts.json and the art they name. It is built here from this phone's own game data, then installed like a patch.
static NSString *PackDir(void) { return [ForgeDir() stringByAppendingPathComponent:@"modpack"]; }
static NSString *gDataRoot = nil;
static BOOL gPendingBuild = NO;
static int gPendingSummon = -1;
static char *ResolveBase(void *ctx, const char *rel) {
    (void)ctx;
    NSString *r = [NSString stringWithUTF8String:rel];
    NSString *orig = [[[ForgeDir() stringByAppendingPathComponent:@"original"] stringByAppendingPathComponent:@"BlazingData"] stringByAppendingPathComponent:r];
    NSString *p = [[NSFileManager defaultManager] fileExistsAtPath:orig] ? orig : [gDataRoot stringByAppendingPathComponent:r];
    return strdup(p.fileSystemRepresentation);
}
static void LogHook(const char *line) { L(@"%s", line); }

static BOOL UnpackPack(NSDictionary<NSString *, NSData *> *z, NSString **msg) {
    NSString *root = nil;
    for (NSString *name in z) if ([name.lastPathComponent isEqualToString:@"forge-mod.json"]) { root = [name stringByDeletingLastPathComponent]; break; }
    if (!root) { *msg = @"This zip has no forge-mod.json, so it isn't a Blazing Forge mod pack."; return NO; }
    NSFileManager *fm = [NSFileManager defaultManager];
    [fm removeItemAtPath:PackDir() error:nil];
    NSString *err = nil;
    for (NSString *name in z) {
        NSString *rel = root.length ? ([name hasPrefix:[root stringByAppendingString:@"/"]] ? [name substringFromIndex:root.length + 1] : nil) : name;
        if (!rel || !SafeRel(rel)) continue;
        if (!PutFile(z[name], [PackDir() stringByAppendingPathComponent:rel], &err)) { *msg = [NSString stringWithFormat:@"Could not unpack %@: %@", rel, err]; return NO; }
    }
    return YES;
}

static void CollectFiles(NSString *root, NSString *prefix, NSMutableDictionary *out) {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSDirectoryEnumerator *en = [fm enumeratorAtPath:root];
    for (NSString *rel in en) {
        BOOL dir = NO; NSString *p = [root stringByAppendingPathComponent:rel];
        if ([fm fileExistsAtPath:p isDirectory:&dir] && !dir) out[[prefix stringByAppendingPathComponent:rel]] = p;
    }
}

static BOOL Install(NSDictionary<NSString *, NSData *> *z, NSString *dataRoot, NSString **msg);

// summon: -1 = as the pack says, 0 = game's own, 1 = custom
static BOOL BuildPack(NSString *dataRoot, int summon, NSString **msg) {
    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm fileExistsAtPath:[PackDir() stringByAppendingPathComponent:@"forge-mod.json"]]) { *msg = @"No mod pack has been installed yet. Drop a mod pack zip in first."; return NO; }
    gDataRoot = dataRoot;
    NSString *outDir = [ForgeDir() stringByAppendingPathComponent:@"build"];
    [fm removeItemAtPath:outDir error:nil];
    NSString *eng = [[[ForgeDir() stringByAppendingPathComponent:@"original"] stringByAppendingPathComponent:@"BlazingEngine"] stringByAppendingPathComponent:@"BlazingEngine.json"];
    if (![fm fileExistsAtPath:eng]) eng = [[Docs() stringByAppendingPathComponent:@"BlazingEngine"] stringByAppendingPathComponent:@"BlazingEngine.json"];
    if (![fm fileExistsAtPath:eng]) eng = [[[NSBundle mainBundle].bundlePath stringByAppendingPathComponent:@"Frameworks"] stringByAppendingPathComponent:@"BlazingEngine.json"];
    fc_log_hook = LogHook;
    FcBuild b = {"", PackDir().fileSystemRepresentation, eng.fileSystemRepresentation, outDir.fileSystemRepresentation, summon, 9, ResolveBase, NULL};
    NSDate *t0 = [NSDate date];
    if (fc_build(&b)) { *msg = [NSString stringWithFormat:@"The mod pack didn't build: %s", fc_err]; return NO; }
    L(@"built in %.1f s", -[t0 timeIntervalSinceNow]);
    // turn the build into the same shape as a patch zip and install it
    NSMutableDictionary *files = [NSMutableDictionary dictionary];
    CollectFiles([outDir stringByAppendingPathComponent:@"Blazing-Rebirth"], @"", files);
    NSMutableDictionary *z = [NSMutableDictionary dictionary], *shas = [NSMutableDictionary dictionary];
    NSString *origDir = [ForgeDir() stringByAppendingPathComponent:@"original"];
    for (NSString *rel in files) {
        NSData *d = [NSData dataWithContentsOfFile:files[rel]]; if (!d) continue;
        z[[@"install/" stringByAppendingString:rel]] = d; shas[rel] = Sha256(d);
        NSString *t = Target(rel, dataRoot);
        if (t && ![fm fileExistsAtPath:[origDir stringByAppendingPathComponent:rel]] && [fm fileExistsAtPath:t] && ![rel containsString:@"content-ios/mods/"]) {
            NSData *o = [NSData dataWithContentsOfFile:t]; if (o) z[[@"original/" stringByAppendingString:rel]] = o;
        }
    }
    char *bdp = ResolveBase(NULL, "blazing-data.json"); NSData *bd = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:bdp]]; free(bdp);
    NSMutableArray *units = [NSMutableArray array];
    for (NSString *f in [[fm contentsOfDirectoryAtPath:[PackDir() stringByAppendingPathComponent:@"units"] error:nil] sortedArrayUsingSelector:@selector(compare:)]) {
        if (![f hasSuffix:@".json"]) continue;
        NSDictionary *u = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:[[PackDir() stringByAppendingPathComponent:@"units"] stringByAppendingPathComponent:f]] ?: [NSData data] options:0 error:nil];
        if ([u isKindOfClass:[NSDictionary class]] && [u[@"gift"] boolValue]) [units addObject:@{@"id": u[@"slot"] ?: @0, @"name": u[@"name"] ?: @"", @"subtitle": u[@"subtitle"] ?: @""}];
    }
    NSDictionary *mf = @{@"format": @1, @"patchId": [NSString stringWithFormat:@"forge-device-%.0f", [NSDate date].timeIntervalSince1970],
                         @"part": @"1 of 1", @"gameVersion": @"2.28.0", @"baseDataSha256": bd ? Sha256(bd) : @"", @"units": units, @"files": shas};
    z[@"forge-patch.json"] = [NSJSONSerialization dataWithJSONObject:mf options:0 error:nil];
    BOOL ok = Install(z, dataRoot, msg);
    [fm removeItemAtPath:outDir error:nil];
    if (ok) *msg = [*msg stringByAppendingString:@"\n\nClose the game completely (swipe it away) and open it again to play with your mod."];
    return ok;
}

static void ShowAlert(void);
static void Run(void) {
    @autoreleasepool {
        NSFileManager *fm = [NSFileManager defaultManager];
        NSArray *items = [fm contentsOfDirectoryAtPath:Docs() error:nil];
        NSMutableArray *zips = [NSMutableArray array];
        for (NSString *f in items) {
            NSString *lf = f.lowercaseString;
            if ([lf hasPrefix:@"blazingforge"] && [lf hasSuffix:@".zip"]) [zips addObject:f];
        }
        L(@"add-on loaded (build 2); Documents has %lu item(s); patch zips found: %lu", (unsigned long)items.count, (unsigned long)zips.count);
        for (NSString *f in items) if ([f.lowercaseString hasSuffix:@".zip"]) L(@"  zip in Documents: %@", f);
        if (!zips.count) { FlushLog(); return; }
        [zips sortUsingSelector:@selector(compare:)];
        NSString *dataRoot = DataRoot();
        NSString *appliedDir = [ForgeDir() stringByAppendingPathComponent:@"applied"];
        [fm createDirectoryAtPath:appliedDir withIntermediateDirectories:YES attributes:nil error:nil];
        NSMutableArray *msgs = [NSMutableArray array]; BOOL allOk = YES;
        for (NSString *f in zips) {
            NSString *path = [Docs() stringByAppendingPathComponent:f];
            NSString *msg = nil; BOOL ok = NO;
            L(@"found %@", f);
            if (!dataRoot) {
                msg = @"The game data (BlazingData) isn't installed yet. Finish the game's own setup first, then reopen the game.";
                allOk = NO; [msgs addObject:msg]; break;
            }
            if ([f.lowercaseString containsString:@"uninstall"]) {
                ok = Uninstall(dataRoot, &msg);
            } else {
                NSString *zerr = nil;
                NSDictionary *z = ReadZip([NSData dataWithContentsOfFile:path options:NSDataReadingMappedIfSafe error:nil] ?: [NSData data], &zerr);
                NSString *modKey = nil;
                for (NSString *k in z) if ([k.lastPathComponent isEqualToString:@"forge-mod.json"]) { modKey = k; break; }
                if (!z) msg = [NSString stringWithFormat:@"%@ could not be read: %@", f, zerr];
                else if (z[@"forge-patch.json"] || !modKey) ok = Install(z, dataRoot, &msg);
                else {
                    // a mod pack (or a summon switch): built in the background from this phone's game data
                    NSDictionary *mj = [NSJSONSerialization JSONObjectWithData:z[modKey] options:0 error:nil];
                    NSString *sw = [mj isKindOfClass:[NSDictionary class]] ? mj[@"summonSwitch"] : nil;
                    if ([sw isKindOfClass:[NSString class]]) { gPendingSummon = [sw isEqualToString:@"off"] ? 0 : 1; gPendingBuild = YES; ok = YES; msg = nil; }
                    else if ((ok = UnpackPack(z, &msg))) { gPendingSummon = -1; gPendingBuild = YES; msg = nil; }
                }
            }
            L(@"%@: %@", ok ? @"ok" : @"FAILED", msg ?: @"mod pack queued for building");
            allOk &= ok; if (msg) [msgs addObject:msg];
            NSString *dst = [appliedDir stringByAppendingPathComponent:f];
            [fm removeItemAtPath:dst error:nil];
            [fm moveItemAtPath:path toPath:dst error:nil];
        }
        gAlertTitle = allOk ? @"Blazing Forge" : @"Blazing Forge: problem";
        gAlertText = msgs.count ? [msgs componentsJoinedByString:@"\n\n"] : nil;
        if (gPendingBuild) {
            gPendingBuild = NO; int summon = gPendingSummon;
            gAlertTitle = @"Blazing Forge";
            gAlertText = [(gAlertText ?: @"") stringByAppendingString:@"Building your mod pack from this phone's game data. This takes about a minute; keep the game open. You'll get a message when it's done."];
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                NSString *m = nil; BOOL ok = BuildPack(dataRoot, summon, &m);
                L(@"%@: %@", ok ? @"built and installed" : @"BUILD FAILED", m); FlushLog();
                dispatch_async(dispatch_get_main_queue(), ^{
                    gAlertTitle = ok ? @"Blazing Forge: mod ready" : @"Blazing Forge: problem"; gAlertText = m; ShowAlert();
                });
            });
        }
        FlushLog();
    }
}

static void ShowAlert(void) {
    if (!gAlertText) return;
    UIWindow *w = nil;
    for (UIWindow *x in [UIApplication sharedApplication].windows) if (x.isKeyWindow) { w = x; break; }
    if (!w) w = [UIApplication sharedApplication].windows.firstObject;
    UIViewController *vc = w.rootViewController;
    while (vc.presentedViewController && !vc.presentedViewController.isBeingDismissed) vc = vc.presentedViewController;
    if (!vc) { dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ShowAlert(); }); return; }
    UIAlertController *a = [UIAlertController alertControllerWithTitle:gAlertTitle message:gAlertText preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    gAlertText = nil;
    [vc presentViewController:a animated:YES completion:nil];
}

__attribute__((constructor)) static void BlazingForgeInit(void) {
    Run();
    if (gAlertText) {
        [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *note) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ ShowAlert(); });
        }];
    }
}

// lets the menu or a future in-app creator re-run the installer without relaunching
__attribute__((visibility("default"))) int blazing_forge_scan(void) { Run(); ShowAlert(); return gAlertText ? 1 : 0; }
