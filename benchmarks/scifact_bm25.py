#!/usr/bin/env python3
"""Reproduce an untrained, lexical SciFact retrieval baseline with stdlib only.

Dataset: https://huggingface.co/datasets/BeIR/scifact (CC BY-SA 4.0).
Code is an evaluation utility, not a LemmaX resource offer or acceptance oracle.
"""

import argparse
import collections
import csv
import datetime
import hashlib
import io
import json
import math
import pathlib
import platform
import re
import time
import zipfile

PUBLISHER_MD5 = "5f7d1de60b170fc8027bb7898e2efca1"
K1, B = 1.2, 0.75
TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def tokens(text):
    return TOKEN_PATTERN.findall(text.lower())


def evaluate_ranking(ranking, relevant):
    """Binary relevance. All scored queries must have at least one gold result."""
    if not relevant:
        raise ValueError("A scored query has no relevant documents")
    if len(set(ranking)) != len(ranking):
        raise ValueError("A ranking contains duplicate document IDs")
    hits5 = sum(doc in relevant for doc in ranking[:5])
    hits10 = sum(doc in relevant for doc in ranking[:10])
    dcg = sum(1 / math.log2(rank + 2) for rank, doc in enumerate(ranking[:10])
              if doc in relevant)
    ideal = sum(1 / math.log2(rank + 2) for rank in range(min(10, len(relevant))))
    first = next((rank + 1 for rank, doc in enumerate(ranking[:10])
                  if doc in relevant), None)
    return {
        "hit_at_5": int(hits5 > 0),
        "recall_at_5": hits5 / len(relevant),
        "recall_at_10": hits10 / len(relevant),
        "ndcg_at_10": dcg / ideal,
        "mrr_at_10": 1 / first if first else 0,
    }


def run(dataset, output):
    blob = dataset.read_bytes()
    if hashlib.md5(blob).hexdigest() != PUBLISHER_MD5:
        raise ValueError("Dataset differs from the BEIR-published SciFact archive")
    started = time.perf_counter()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        # Read exact archive members in memory. No extraction of archive paths.
        corpus = [json.loads(line) for line in archive.read("scifact/corpus.jsonl").splitlines()]
        queries = {str(q["_id"]): q["text"] for q in
                   map(json.loads, archive.read("scifact/queries.jsonl").splitlines())}
        qrels = collections.defaultdict(set)
        reader = csv.DictReader(io.StringIO(archive.read("scifact/qrels/test.tsv").decode()),
                                delimiter="\t")
        for row in reader:
            if int(row["score"]) != 1:
                raise ValueError("This baseline's metric implementation requires binary qrels")
            qrels[row["query-id"]].add(row["corpus-id"])
    doc_ids = [str(doc["_id"]) for doc in corpus]
    if len(doc_ids) != len(set(doc_ids)):
        raise ValueError("Duplicate corpus IDs")
    doc_set = set(doc_ids)
    if not set(qrels).issubset(queries):
        raise ValueError("Qrels refer to missing queries")
    if any(not gold.issubset(doc_set) for gold in qrels.values()):
        raise ValueError("Qrels refer to missing documents")

    postings = collections.defaultdict(list)
    lengths = {}
    for doc in corpus:
        doc_id = str(doc["_id"])
        frequencies = collections.Counter(tokens(doc["title"] + " " + doc["text"]))
        lengths[doc_id] = sum(frequencies.values())
        for term, frequency in frequencies.items():
            postings[term].append((doc_id, frequency))
    count = len(corpus)
    average_length = sum(lengths.values()) / count
    index_seconds = time.perf_counter() - started

    result_rows = []
    latencies = []
    for query_id in sorted(qrels):
        query_started = time.perf_counter()
        scores = collections.defaultdict(float)
        for term in sorted(set(tokens(queries[query_id]))):
            entries = postings.get(term, ())
            idf = math.log1p((count - len(entries) + 0.5) / (len(entries) + 0.5))
            for doc_id, frequency in entries:
                if doc_id == query_id:
                    continue  # Match BEIR's default same-ID exclusion.
                normalization = K1 * (1 - B + B * lengths[doc_id] / average_length)
                scores[doc_id] += idf * frequency * (K1 + 1) / (frequency + normalization)
        top = sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))[:10]
        latencies.append((time.perf_counter() - query_started) * 1000)
        ranking = [doc_id for doc_id, _ in top]
        result_rows.append({
            "query_id": query_id,
            "relevant_document_ids": sorted(qrels[query_id]),
            "ranking": ranking,
            "scores": [score for _, score in top],
            "metrics": evaluate_ranking(ranking, qrels[query_id]),
        })

    metrics = {key: sum(row["metrics"][key] for row in result_rows) / len(result_rows)
               for key in result_rows[0]["metrics"]}
    elapsed = time.perf_counter() - started
    result = {
        "benchmark": "BEIR SciFact test",
        "dataset_url": "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip",
        "dataset_license": "CC BY-SA 4.0",
        "dataset_md5": hashlib.md5(blob).hexdigest(),
        "dataset_sha256": hashlib.sha256(blob).hexdigest(),
        "code_sha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        "method": "Custom untuned BM25 baseline; not the official BEIR BM25 implementation",
        "configuration": {
            "k1": K1, "b": B, "tokenizer": "lowercase ASCII alphanumeric runs",
            "document_text": "title + space + text", "stemming": False,
            "stopword_removal": False, "query_term_frequency": "ignored",
            "idf": "log(1 + (N - df + 0.5) / (df + 0.5))",
            "tie_break": "document ID ascending lexicographically",
            "same_query_and_document_id_excluded": True, "top_k": 10,
            "tuning_on_test_set": False,
        },
        "corpus_documents": count,
        "scored_test_queries": len(result_rows),
        "qrel_pairs": sum(len(gold) for gold in qrels.values()),
        "queries_with_relevant_result_at_5": sum(row["metrics"]["hit_at_5"] for row in result_rows),
        "empty_rankings": sum(not row["ranking"] for row in result_rows),
        "mean_query_metrics": metrics,
        "run": {
            "utc_time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "python_version": platform.python_version(),
            "index_build_seconds": index_seconds,
            "total_seconds": elapsed,
            "local_mean_ranking_ms": sum(latencies) / len(latencies),
            "local_p95_ranking_ms": sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1],
            "latency_scope": "One local process; query scoring and sorting only. Not an API SLA.",
            "paid_api_calls": 0, "training_runs": 0,
        },
        "interpretation": "Public relevance evidence only. Not enterprise adoption, ACL, freshness, or answer accuracy.",
        "per_query": result_rows,
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "scifact-bm25-results.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "per_query"}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()
    run(args.dataset, args.output)
