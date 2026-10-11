"""Unit tests for the read-only new-ID planning tool."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'new_id_lab.py'
spec = importlib.util.spec_from_file_location('new_id_lab', SCRIPT)
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class NewIdPlanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'units').mkdir()
        (self.root / 'banners').mkdir()
        for slot in (13495, 13496):
            (self.root / 'units' / f'{slot}.json').write_text(
                json.dumps({'slot': slot, 'donor': 10476, 'name': 'Naruto'}))
        (self.root / 'banners' / 'test.json').write_text(
            json.dumps({'id': 60004, 'featured': [13495]}))
        self.mapping = {'13495': 480045, '13496': 480046}

    def test_successful_plan_and_banner_preview(self):
        result = lab.validate(self.root, self.mapping, {10476, 13495, 13496})
        self.assertTrue(result['valid'])
        self.assertFalse(result['installable'])
        self.assertTrue(result['checkedAgainstServer'])
        self.assertEqual(result['banners'][0]['featuredProposed'], [480045])
        self.assertEqual([u['proposedId'] for u in result['units']], [480045, 480046])

    def test_collision_rejected(self):
        result = lab.validate(self.root, self.mapping, {480046, 10476})
        self.assertFalse(result['valid'])
        self.assertIn('already exists', ' '.join(result['errors']))

    def test_duplicate_and_missing_mapping_rejected(self):
        result = lab.validate(self.root, {'13495': 480045}, None)
        self.assertFalse(result['valid'])
        self.assertIn('missing proposed ID', ' '.join(result['errors']))
        result = lab.validate(self.root, {'13495': 480045, '13496': 480045}, None)
        self.assertFalse(result['valid'])
        self.assertIn('same new ID', ' '.join(result['errors']))

    def test_zip_pack(self):
        archive_path = self.root / 'mod.zip'
        with zipfile.ZipFile(archive_path, 'w') as z:
            for path in list((self.root / 'units').glob('*.json')) + list((self.root / 'banners').glob('*.json')):
                z.write(path, path.relative_to(self.root).as_posix())
        self.assertTrue(lab.validate(archive_path, self.mapping)['valid'])

    def test_unknown_slot_rejected(self):
        result = lab.validate(self.root, {'13495':480045, '13496':480046,'99999':480055})
        self.assertFalse(result['valid'])
        self.assertIn('unknown original slot', ' '.join(result['errors']))

    def test_preflight_schema(self):
        self.assertEqual(lab.id_set({'units': [100, 101]}), {100, 101})
        self.assertEqual(lab.id_set({'units': [{'unitId': 100}]}), {100})
        self.assertEqual(lab.id_set({'datas': [{'id': 100}]}), {100})


if __name__ == '__main__':
    unittest.main()
