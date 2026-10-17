"""Build the password-locked test-unit bundle for the Sprites page.

The page fetches sprites/locked/test-units.bin and decrypts it in the browser with the
password (PBKDF2-SHA256 -> AES-256-GCM). Without the password the file is unreadable.

usage:
  python3 tools/lock_sprites.py --password '...' --label 'Name' \
      --sheet atlases/0793adf647091be1376c68f5.png=path/to/sheet.png \
      --unit 12396 \
      --out sprites/locked/test-units.bin

--sheet  atlas=png   replaces that game atlas (as named in the catalog, e.g. atlases/<id>.png)
                     for every unit and move that uses it; character and effect sheets alike
--unit   id[=label]  lists a unit under "Test units" in the picker once unlocked
To change the password, run it again with the same files and a new --password.
"""
import argparse, base64, json, os, struct, sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 600_000


def data_url(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--password', required=True)
    ap.add_argument('--label', required=True, help='name shown on the sheet buttons once unlocked')
    ap.add_argument('--sheet', action='append', default=[])
    ap.add_argument('--unit', action='append', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if len(a.password) < 10:
        sys.exit('use a password of at least 10 characters')
    sheets = {}
    for s in a.sheet:
        atlas, path = s.split('=', 1)
        sheets[atlas] = data_url(path)
    units = {}
    for u in a.unit:
        uid, _, label = u.partition('=')
        units[uid] = {'label': label or a.label}
    plain = json.dumps({'v': 2, 'label': a.label, 'units': units, 'sheets': sheets}, separators=(',', ':')).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(a.password.encode())
    body = AESGCM(key).encrypt(iv, plain, None)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'wb') as f:
        f.write(b'BFL1' + struct.pack('>I', ITERATIONS) + salt + iv + body)
    print(f'wrote {a.out} ({os.path.getsize(a.out) // 1024} KB) with {len(sheets)} sheet(s) for {len(units)} unit(s)')


if __name__ == '__main__':
    main()
