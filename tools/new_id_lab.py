#!/usr/bin/env python3
"""Read-only preflight planner for prospective, independent Blazing Forge IDs.

No game, server, or mod data is modified. This is NOT an installer or server patch.
"""
import argparse
import json
from pathlib import Path
import sys
import zipfile


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def unit_specs(mod):
    path = Path(mod)
    if path.is_dir():
        sources = [(str(p.relative_to(path)).replace('\\', '/'), p.read_bytes())
                   for p in sorted((path / 'units').glob('*.json'))]
        banners = [(str(p.relative_to(path)).replace('\\', '/'), p.read_bytes())
                   for p in sorted((path / 'banners').glob('*.json'))]
    else:
        with zipfile.ZipFile(path) as archive:
            files = [(n, archive.read(n)) for n in archive.namelist()
                     if (n.startswith('units/') or n.startswith('banners/')) and n.endswith('.json')]
        sources = [(n, data) for n, data in files if n.startswith('units/')]
        banners = [(n, data) for n, data in files if n.startswith('banners/')]
    if not sources:
        raise ValueError('No units/*.json were found at the mod root')
    return [(n, json.loads(data)) for n, data in sources], [(n, json.loads(data)) for n, data in banners]


def id_set(document):
    """Accept actual server preflight {units:[ids]}, or unit/catalog JSON."""
    if isinstance(document, list):
        rows = document
    elif isinstance(document, dict):
        rows = next((document[k] for k in ('units', 'datas', 'playableUnits')
                     if isinstance(document.get(k), list)), None)
    else:
        rows = None
    if rows is None:
        raise ValueError('Expected a list of IDs or a units/datas array')
    return {int(r.get('unitId', r.get('id'))) if isinstance(r, dict) else int(r)
            for r in rows}


def validate(mod, proposed, known_ids=None):
    specs, banners = unit_specs(mod)
    errors, warnings = [], []
    by_slot = {}
    for filename, spec in specs:
        if 'slot' not in spec:
            errors.append(f'{filename}: expected replacement-mode "slot" (no changes made)')
            continue
        try:
            old = int(spec['slot'])
        except (TypeError, ValueError):
            errors.append(f'{filename}: invalid slot')
            continue
        if old in by_slot:
            errors.append(f'duplicate original slot {old}')
        by_slot[old] = (filename, spec)
    proposed = {int(k): int(v) for k, v in proposed.items()}
    for old in sorted(set(proposed) - set(by_slot)):
        errors.append(f'mapping has unknown original slot {old}')
    for old in sorted(set(by_slot) - set(proposed)):
        errors.append(f'missing proposed ID for slot {old}')
    new_ids = list(proposed.values())
    if len(set(new_ids)) != len(new_ids):
        errors.append('two original slots map to the same new ID')
    existing = set(known_ids) if known_ids is not None else None
    records = []
    for old in sorted(by_slot):
        filename, spec = by_slot[old]
        if old not in proposed:
            continue
        new = proposed[old]
        if not (1 <= new <= 499999):
            errors.append(f'{old}: proposed ID {new} is outside Forge 1..499999 range')
        if new in by_slot:
            errors.append(f'{old}: proposed ID {new} is another original slot')
        if existing is not None and new in existing:
            errors.append(f'{old}: proposed ID {new} already exists in server preflight')
        donor = int(spec.get('donor', 0))
        if donor == new:
            errors.append(f'{old}: new ID and animation donor cannot be identical')
        if existing is not None and donor not in existing:
            warnings.append(f'{old}: animation donor {donor} is not in preflight playable IDs')
        records.append({'file': filename, 'sourceSlot': old, 'proposedId': new,
                        'donor': donor, 'name': spec.get('name', ''),
                        'subtitle': spec.get('subtitle', '')})
    # Validate pairs without assuming all mods contain only a 5*/6* pair.
    for rec in records:
        old = rec['sourceSlot']
        partner = old + 1 if old % 10 == 5 else old - 1 if old % 10 == 6 else None
        if partner is not None and partner in proposed and old < partner:
            if proposed[old] + 1 != proposed[partner]:
                warnings.append(f'{old}/{partner}: proposed awakening IDs are not consecutive')
            if proposed[old] % 10 != 5 or proposed[partner] % 10 != 6:
                warnings.append(f'{old}/{partner}: proposed IDs do not end with 5/6')
    banner_plans = []
    for filename, banner in banners:
        original = [int(x) for x in banner.get('featured', [])]
        rewritten = [proposed.get(x, x) for x in original]
        unknown = [x for x in original if x not in by_slot]
        if unknown:
            warnings.append(f'{filename}: featured IDs not in mod slots: {unknown}')
        banner_plans.append({'file': filename, 'bannerId': banner.get('id'),
                             'featuredBefore': original, 'featuredProposed': rewritten})
    if known_ids is None:
        warnings.append('No preflight provided; proposed IDs have NOT been checked against the running server')
    return {'schemaVersion': 1, 'status': 'proposal-only', 'installable': False,
            'checkedAgainstServer': known_ids is not None, 'valid': not errors,
            'errors': errors, 'warnings': warnings, 'units': records, 'banners': banner_plans,
            'nextSteps': ['Register IDs in Unity unit master and dependent tables',
                          'Extend server catalogs and integrity policy in a separate test instance',
                          'Update summon-pool identity and eligibility for new units',
                          'Test UI, battle rig, persistence and iOS/Android clients']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mod', required=True, help='Existing Forge mod folder or ZIP (read only)')
    parser.add_argument('--id-map', required=True, help='JSON object mapping original slot IDs to proposed IDs')
    parser.add_argument('--preflight', help='Optional JSON from /diagnostics/unit-preflight')
    parser.add_argument('--out', help='Write report JSON to this path (not a mod pack)')
    args = parser.parse_args(argv)
    try:
        known = id_set(load_json(args.preflight)) if args.preflight else None
        result = validate(args.mod, load_json(args.id_map), known)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        parser.exit(2, f'New-ID lab input error: {exc}\n')
    output = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    if args.out:
        Path(args.out).write_text(output, encoding='utf-8')
    else:
        print(output, end='')
    return 0 if result['valid'] else 1


if __name__ == '__main__':
    sys.exit(main())
