"""Build the password-locked test-unit bundle for the Sprites page.

The page fetches sprites/locked/test-units.bin and decrypts it in the browser with the
password (PBKDF2-SHA256 -> AES-256-GCM). Without the password the file is unreadable.

usage:
  python3 tools/lock_sprites.py --password '...' --label 'Name' \
      --sheet taka=path/to/sheet.png --sheet robe=path/to/sheet.png \
      --fx robe:Jutsu=path/to/effect.png \
      --out sprites/locked/test-units.bin

--sheet  unit=png        replaces that unit's character sheet (unit keys: taka, robe, hayate)
--fx     unit:Role=png   adds an alternate effect sheet for a technique ("Jutsu" or "Secret Technique")
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
    ap.add_argument('--fx', action='append', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if len(a.password) < 10:
        sys.exit('use a password of at least 10 characters')
    units = {}
    for s in a.sheet:
        key, path = s.split('=', 1)
        units.setdefault(key, {})['sheet'] = data_url(path)
    for s in a.fx:
        left, path = s.split('=', 1)
        key, role = left.split(':', 1)
        units.setdefault(key, {}).setdefault('fx', {})[role] = data_url(path)
    plain = json.dumps({'v': 1, 'label': a.label, 'units': units}, separators=(',', ':')).encode()
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(a.password.encode())
    body = AESGCM(key).encrypt(iv, plain, None)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'wb') as f:
        f.write(b'BFL1' + struct.pack('>I', ITERATIONS) + salt + iv + body)
    print(f'wrote {a.out} ({os.path.getsize(a.out) // 1024} KB) with {len(units)} unit(s)')


if __name__ == '__main__':
    main()
