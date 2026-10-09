# Third-party data and references

## SciFact / BEIR benchmark

The derived rankings and relevance records in `benchmarks/scifact-bm25-results.json` come from the SciFact test collection distributed through BEIR. The recorded dataset license is **CC BY-SA 4.0**. These derived data retain that license and attribution; this statement does not choose a license for the original LemmaX code.

- [BEIR SciFact dataset and license](https://huggingface.co/datasets/BeIR/scifact)
- [BEIR project](https://github.com/beir-cellar/beir)
- [SciFact project](https://github.com/allenai/scifact)
- [Dataset archive](https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip)
- [CC BY-SA 4.0 terms](https://creativecommons.org/licenses/by-sa/4.0/)

The custom untuned lexical runner is not the official BEIR BM25 implementation. The result file records dataset/code hashes, configuration, observation counts, local timing and limitations. Original document text is not included. No commercial model, pretrained weights or source code from the inspected sibling repositories is redistributed here.

## Mathematical reference

The probability specification uses the [NIST Beta distribution reference](https://www.itl.nist.gov/div898/handbook/eda/section3/eda366h.htm). The implementation evaluates the regularized incomplete Beta function numerically and inverts it by bisection within its documented domain.

## CI actions

GitHub Actions checkout and setup-node are referenced at pinned commit hashes in the workflow. They are not vendored into the repository. Their original licenses and notices remain with the upstream projects.
