"""Build portable, counter-based evidence from JaCoCo XML and V8 JSON summary."""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--java', required=True)
p.add_argument('--react', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
r = ET.parse(a.java).getroot()

def counters(element):
    result = {}
    for c in element.findall('counter'):
        covered, missed = int(c.get('covered')), int(c.get('missed'))
        result[c.get('type').lower()] = {'covered': covered, 'total': covered + missed,
            'pct': round(100 * covered / (covered + missed), 2) if covered + missed else 100}
    return result

react = json.loads(Path(a.react).read_text())
files = {}
for key, value in react.items():
    if key != 'total':
        files['src/' + key.replace('\\', '/').split('/src/', 1)[-1]] = value
result = {'java': {'total': counters(r), 'classes': {
    c.get('name'): counters(c) for c in r.findall('.//class')}},
    'react': {'total': react['total'], 'files': files}}
Path(a.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
