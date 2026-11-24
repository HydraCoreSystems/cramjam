#!/usr/bin/env python3
"""Binary gate: proves every symbol the app's binaries import will resolve at launch.

Usage: binary-gate.py <app.ipa> <report.txt>   (macOS, Xcode selected; exits 1 on any failure)

For every Mach-O binary in the .app (the main executable, every framework, every dylib):
  * an import bound to a library inside the bundle (@rpath, @executable_path, @loader_path) must be
    exported by that very binary;
  * an import bound to a system library must be exported by some library in the iOS SDK (.tbd stubs);
  * an import looked up by name at runtime (flat namespace, "dynamically looked up") must be exported by
    some binary in the bundle or by the SDK.
Weak imports are allowed to be missing, as dyld allows. A non-weak load of a bundle library that is not
in the bundle is a failure too. The gate passes only at zero unresolved imports.

Two pairs that have failed before are also checked by name: ExpoModulesCore into React for
RCTStatusBarAppearance (the SellerSeal launch crash) and ExpoFileSystem into ExpoModulesJSI for
JavaScriptObject.setProperty(_:encodingWith:) (the CramJam build 2 launch crash).
"""
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

KNOWN_JSI_SYMBOL = (
    "_$s14ExpoModulesJSI16JavaScriptObjectV11setProperty_12encodingWithySS_yAA0dE5ValueV4SlotV_"
    "AA0dE7RuntimeCtYbKAA0dE5ActorCYcXEtKF"
)

UNDEF = re.compile(
    r"\(undefined\)\s+(?:\[[^\]]*\]\s+)?(weak\s+)?external\s+(\S+)\s+"
    r"\((?:from\s+([^)]+)|(dynamically looked up))\)"
)


def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def is_macho(path):
    with open(path, "rb") as f:
        magic = f.read(4)
    return magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")


def short_name(install_name):
    # nm -m names a library by its leaf: Foundation, libSystem (from libSystem.B.dylib), ExpoModulesJSI.
    return os.path.basename(install_name).split(".")[0]


def loads(binary):
    """(install name, weak) for every library the binary loads."""
    out = run("otool", "-l", "-arch", "arm64", binary)
    result, cmd = [], None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("cmd "):
            cmd = line.split()[1]
        elif line.startswith("name ") and cmd in ("LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB", "LC_LAZY_LOAD_DYLIB", "LC_LOAD_UPWARD_DYLIB"):
            result.append((line.split()[1], cmd == "LC_LOAD_WEAK_DYLIB"))
    return result


def exports(binary):
    return set(run("nm", "-gUj", "-arch", "arm64", binary).split())


def sdk_exports():
    sdk = run("xcrun", "--sdk", "iphoneos", "--show-sdk-path").strip()
    syms = set()
    for tbd in glob.glob(f"{sdk}/**/*.tbd", recursive=True):
        with open(tbd, errors="replace") as f:
            text = f.read()
        if text.lstrip().startswith("{"):
            collect_v5(json.loads(text), syms)
        else:
            collect_v4(text, syms)
    return sdk, syms


def add_objc(kind, name, syms):
    if kind in ("objc-classes", "objc_class"):
        syms.add(f"_OBJC_CLASS_$_{name}")
        syms.add(f"_OBJC_METACLASS_$_{name}")
    elif kind in ("objc-eh-types", "objc_eh_type"):
        syms.add(f"_OBJC_EHTYPE_$_{name}")
    elif kind in ("objc-ivars", "objc_ivar"):
        syms.add(f"_OBJC_IVAR_$_{name}")
    else:
        syms.add(name)


def collect_v4(text, syms):
    keys = "symbols|weak-symbols|thread-local-symbols|objc-classes|objc-eh-types|objc-ivars"
    for m in re.finditer(rf"(?<![\w-])({keys}):\s*\[([^\]]*)\]", text, re.S):
        for item in m.group(2).split(","):
            name = item.strip().strip("'\"")
            if name:
                add_objc(m.group(1), name, syms)


def collect_v5(node, syms):
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("global", "weak", "thread_local", "objc_class", "objc_eh_type", "objc_ivar") and isinstance(value, list):
                for name in value:
                    if isinstance(name, str):
                        add_objc(key, name, syms)
            else:
                collect_v5(value, syms)
    elif isinstance(node, list):
        for item in node:
            collect_v5(item, syms)


def main(ipa, report_path):
    work = tempfile.mkdtemp(prefix="binary-gate-")
    with zipfile.ZipFile(ipa) as z:
        z.extractall(work)
    apps = glob.glob(f"{work}/Payload/*.app")
    if len(apps) != 1:
        raise SystemExit(f"expected one .app in {ipa}, found {apps}")
    app = apps[0]

    binaries = []
    for root, _, files in os.walk(app):
        for f in files:
            p = os.path.join(root, f)
            if not os.path.islink(p) and os.path.getsize(p) > 4 and is_macho(p):
                binaries.append(p)
    binaries.sort()
    rel = lambda p: os.path.relpath(p, app)
    exported = {p: exports(p) for p in binaries}
    by_leaf = {}
    for p in binaries:
        by_leaf.setdefault(os.path.basename(p), []).append(p)
    everything_in_bundle = set().union(*exported.values())
    sdk, system = sdk_exports()

    lines = [f"Binary gate for {os.path.basename(ipa)}", f"App: {os.path.basename(app)}", f"SDK stubs: {sdk} ({len(system)} exported symbols)",
             f"Mach-O binaries checked: {len(binaries)}", ""]
    unresolved, checked = [], 0
    resolved_in = {}
    for b in binaries:
        libs = {}
        missing_libs = []
        for name, weak in loads(b):
            libs[short_name(name)] = (name, weak)
            if name.startswith("@"):
                if os.path.basename(name) not in by_leaf and not weak:
                    missing_libs.append(name)
        for name in missing_libs:
            unresolved.append((rel(b), "<load>", name, "bundle library not in the app"))
        count = 0
        for line in run("nm", "-m", "-u", "-arch", "arm64", b).splitlines():
            m = UNDEF.search(line)
            if not m:
                continue
            weak, sym, lib, flat = bool(m.group(1)), m.group(2), m.group(3), m.group(4)
            count += 1
            if flat:
                ok = sym in everything_in_bundle or sym in system
                where = "flat lookup"
                if not ok and not weak:
                    unresolved.append((rel(b), sym, where, "not exported by any bundle binary or SDK library"))
                continue
            if lib in ("executable", "self"):
                main_exe = os.path.join(app, os.path.basename(app)[:-4])
                ok = sym in exported.get(main_exe, set()) or lib == "self"
                if not ok and not weak:
                    unresolved.append((rel(b), sym, lib, "not exported by the main executable"))
                continue
            install, _ = libs.get(lib, (None, False))
            if install is None:
                unresolved.append((rel(b), sym, lib, "bound to a library the binary does not load"))
                continue
            if install.startswith("@"):
                targets = by_leaf.get(os.path.basename(install), [])
                ok = any(sym in exported[t] for t in targets)
                if ok:
                    resolved_in[(rel(b), sym)] = rel(targets[0])
                if not ok and not weak:
                    unresolved.append((rel(b), sym, install, "not exported by that bundle binary" if targets else "library not in the app"))
            else:
                ok = sym in system
                if not ok and not weak:
                    unresolved.append((rel(b), sym, install, "not exported by the iOS SDK"))
        checked += count
        lines.append(f"  {rel(b)}: {count} imports, {len(libs)} libraries loaded")

    lines += ["", f"Imports checked: {checked}", f"Unresolved: {len(unresolved)}"]
    for b, sym, where, why in unresolved:
        lines.append(f"  UNRESOLVED {b}: {sym} <- {where}: {why}")

    # The two named pairs.
    lines.append("")
    lines.append("Named pairs:")
    pair_ok = True
    core = [p for p in binaries if os.path.basename(p) == "ExpoModulesCore"]
    if core:
        imports = [s for s in (UNDEF.search(l) for l in run("nm", "-m", "-u", "-arch", "arm64", core[0]).splitlines()) if s and "RCTStatusBarAppearance" in s.group(2)]
        if not imports:
            lines.append("  ExpoModulesCore -> React RCTStatusBarAppearance: ExpoModulesCore imports no RCTStatusBarAppearance symbol (nothing to resolve)")
        for s in imports:
            key = (rel(core[0]), s.group(2))
            target = resolved_in.get(key)
            bad = any(u[0] == key[0] and u[1] == key[1] for u in unresolved)
            pair_ok &= not bad
            lines.append(f"  ExpoModulesCore -> {s.group(2)}: {'UNRESOLVED' if bad else 'resolved in ' + (target or s.group(3) or 'flat lookup')}")
    else:
        statics = [p for p in binaries if "RCTStatusBarAppearance" in " ".join(sorted(exported[p]))]
        lines.append("  ExpoModulesCore: not a separate binary in this app (linked statically); "
                     f"RCTStatusBarAppearance exported by: {[rel(p) for p in statics] or 'none'}")
    fs = [p for p in binaries if os.path.basename(p) == "ExpoFileSystem"]
    jsi = [p for p in binaries if os.path.basename(p) == "ExpoModulesJSI"]
    fs_imports = set()
    if fs:
        fs_imports = {m.group(2) for m in (UNDEF.search(l) for l in run("nm", "-m", "-u", "-arch", "arm64", fs[0]).splitlines()) if m}
    jsi_has = bool(jsi) and KNOWN_JSI_SYMBOL in exported[jsi[0]]
    lines.append(f"  ExpoFileSystem imports setProperty(_:encodingWith:) [crash symbol]: {KNOWN_JSI_SYMBOL in fs_imports if fs else 'ExpoFileSystem not a separate binary'}")
    lines.append(f"  ExpoModulesJSI exports it: {jsi_has if jsi else 'ExpoModulesJSI not a separate binary'}")
    if fs and KNOWN_JSI_SYMBOL in fs_imports and not jsi_has:
        pair_ok = False
    fs_into_jsi = sorted(s for (b, s), t in resolved_in.items() if os.path.basename(b) == "ExpoFileSystem" and os.path.basename(t) == "ExpoModulesJSI")
    lines.append(f"  ExpoFileSystem -> ExpoModulesJSI imports resolved: {len(fs_into_jsi)}")

    passed = not unresolved and pair_ok
    lines += ["", "GATE: PASS" if passed else "GATE: FAIL"]
    with open(report_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
