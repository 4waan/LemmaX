#!/usr/bin/env python3
"""Prepare exact public benchmark members outside git. No archive path extraction."""
import argparse
import hashlib
import io
import pathlib
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dataset', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
blob = args.dataset.read_bytes()
if hashlib.md5(blob).hexdigest() != '5f7d1de60b170fc8027bb7898e2efca1':
    raise ValueError('Dataset differs from the BEIR-published archive')
args.output.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(blob)) as archive:
    for name, member in [('corpus.jsonl', 'scifact/corpus.jsonl'), ('queries.jsonl', 'scifact/queries.jsonl'), ('test.tsv', 'scifact/qrels/test.tsv')]:
        (args.output/name).write_bytes(archive.read(member))
print('Prepared corpus, queries and qrels. Original document text must remain outside git.')
