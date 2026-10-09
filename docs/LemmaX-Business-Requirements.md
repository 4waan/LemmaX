# LemmaX: business requirements and benchmark evidence

Prepared October 9, 2026. This continues the [architecture](LemmaX-Architecture.md) and [mathematics/API](LemmaX-Math-and-API.md). The three candidate capabilities are invoice extraction, support classification, and knowledge retrieval. Hosted access and company-run model assets remain desired catalog forms.

**Current decision:** do not use the tentative knowledge base as trusted evidence. Use reproducible public benchmarks first, followed by tests of the actual connector and an authorized company workload. No company corpus, willingness to pay, first capability, or purchased right has been confirmed. The research below informs that decision rather than substituting a preference score for it.

## 1. What the business evidence establishes

### Invoice extraction

Uber describes an accounts-payable workflow involving varied invoice documents, header fields, line items, downstream processing, and human review. It reports a 70% reduction in average handling time and 25% to 30% cost savings after a GenAI workflow change. These are company-reported results for its whole workflow, not isolated model performance or a forecast for LemmaX. They provide concrete evidence of a costly business task. [Uber engineering report](https://www.uber.com/in/en/blog/advancing-invoice-document-processing-using-genai/).

The plausible buyer is accounts-payable operations, with a finance systems owner responsible for integration. A narrow capability could return specified invoice fields and line items with source references. Whether the business accepts an invoice must depend on its required fields and correction policy. An average across easy fields cannot establish that all payment-critical values are correct.

Measure field precision/recall, normalization errors, document-level acceptance, manual corrections, review time, and downstream schema compatibility. Google documents field-level precision, recall, and F1 for its extraction evaluators. LemmaX must additionally define the buyer's whole-document acceptance rule. [Document AI evaluation](https://docs.cloud.google.com/document-ai/docs/evaluate).

Business requirements to obtain: monthly document/page volume; supplier and language mix; critical fields; current review effort; accepted monetary tolerances; representative gold labels; retention rules; ERP output schema; and consequences of an incorrect accepted document. For a bounded demonstration, returning validated data is more manageable than posting invoices to a production ledger. This is a scope proposal, not a selected product.

### Support classification

Qualia's published customer account describes automated triage and routing by customer and topic. Starshipit describes intelligent triage alongside summarization and other automation. These establish operational use of the capability. Their bundled workflow results do not isolate a classifier's causal contribution or prove demand for LemmaX. [Qualia customer account](https://www.zendesk.com/customer/qualia/), [Starshipit customer account](https://www.zendesk.com/customer/starshipit/).

The plausible buyer is support operations, with the helpdesk integration owner. A narrow capability returns one label from a versioned business taxonomy, or an explicit abstention. It needs to distinguish costly misroutes from tolerable ones. Existing helpdesk products already offer intent, sentiment, and language-based workflow automation, so LemmaX needs a reason to be purchased beyond reproducing an incumbent feature. Portability, company-run execution, and comparable evidence are possible reasons to test, not proven demand. [Zendesk triage workflows](https://support.zendesk.com/hc/en-us/articles/5222280338202-Intelligent-triage-use-cases-and-workflows).

Measure macro F1, per-class precision/recall, confusion counts, abstention coverage, review effort, and business-weighted errors. Freeze the taxonomy before evaluation. A rare urgent class needs its own examples and loss policy. Overall accuracy can conceal failure on that class. A model's reported confidence also needs empirical calibration before becoming a probability presented to a buyer.

Business requirements to obtain: label definitions and ambiguous cases; class prevalence; routing destinations; language distribution; rare high-cost classes; escalation rules; current misroutes; ticket access restrictions; and the cost of review versus automatic routing. This capability has the clearest bounded output of the three, but company-specific labels remain essential.

### Knowledge retrieval

Atlassian's engineering account describes search across connected sources, lexical and vector retrieval, reranking, and permission checks. This supports a concrete connector workflow. It also shows that access enforcement is part of enterprise retrieval, beyond relevance metrics. [Atlassian search architecture](https://www.atlassian.com/blog/rovo/unraveling-rovo-search).

The plausible buyer is an internal platform or knowledge owner, with source-system administrators. A narrow capability returns ranked, authorized source IDs and excerpts for a query, with provenance and corpus/version references. Generating an answer is a separate acceptance target. This keeps the directory's comparison bounded and avoids introducing an adoption-planning agent.

Measure relevant-result Hit@k, recall@k, nDCG@k, end-to-end latency, query cost, ingestion/update cost, and unsupported-query handling. Separately test authentication, tenant isolation, source permissions, permission revocation, updates/deletions, and provenance. A permission violation rejects an offer under that policy; strong average relevance does not compensate for it. Connector synchronization behavior must be measured against the buyer's agreed freshness requirement. [Atlassian connector permission synchronization](https://support.atlassian.com/organization-administration/docs/how-connector-permissions-are-kept-in-sync/).

Business requirements to obtain: source systems; corpus size; query mix and labels; user/groups and permissions; update/revocation deadlines; languages; acceptable excerpts; query volume; and current search time or missed-information cost. Retrieval aligns closely with sellable MCP connectors, but has the largest permission and freshness surface. A public scientific corpus cannot validate that surface.

## 2. Benchmarks and evidence access

**Extraction:** DocILE offers 6,680 annotated business documents and evaluates key information and line-item extraction. Access requires a request, and its code license does not grant unrestricted dataset use. It is a useful research candidate, not an immediately available authorized customer corpus. No extraction benchmark was run here. [DocILE benchmark](https://docile.rossum.ai/), [official repository and access instructions](https://github.com/rossumai/docile).

**Classification:** BANKING77 contains 13,083 English queries across 77 banking intents, with a 10,003/3,080 train/test split and a CC BY 4.0 license. Its fixed test set is a reproducible starting point, although banking intents do not establish performance on another company's taxonomy. No classifier was benchmarked here. Check candidate model training data for benchmark contamination before interpreting results. [Official dataset card](https://huggingface.co/datasets/PolyAI/banking77), [publisher's data files](https://github.com/PolyAI-LDN/task-specific-datasets/tree/master/banking_data).

**Retrieval:** BEIR provides multiple retrieval tasks and standard metrics. The SciFact test set is immediately usable for a small offline relevance baseline. The dataset card specifies CC BY-SA 4.0; the benchmark code and individual datasets have different licenses. Benchmark across additional domains before claiming broad retrieval performance. [BEIR repository](https://github.com/beir-cellar/beir), [SciFact dataset card and attribution](https://huggingface.co/datasets/BeIR/scifact).

Public benchmark results answer a restricted question: how a specified pipeline performs on that dataset. They do not estimate company adoption success. Company-specific compatibility remains unknown until its deployment and acceptance policy are evaluated.

## 3. Actual retrieval baseline

Executed locally on October 9, 2026 using the official SciFact archive. The archive MD5 matches BEIR's published value. The runner uses Python's standard library, an untuned BM25 implementation, title plus document text, lowercase ASCII tokenization, `k1=1.2`, `b=0.75`, no stemming or stopword removal, and no test-set tuning. It is not the official BEIR BM25 implementation. Ranking configuration and hashes are preserved in the result file.

Measured on **5,183 documents, 300 test queries, and 339 labeled query/document pairs**:

- Hit@5: **224/300 = 74.67%** of queries had at least one labeled relevant document in the first five results.
- Mean recall@5: **72.43%**. This differs from Hit@5 because some queries have multiple relevant documents.
- Mean recall@10: **78.76%**.
- Mean nDCG@10: **0.660464**.
- Mean reciprocal rank@10: **0.626970**.
- Empty rankings: **0**. This does not mean every ranking was useful.
- Paid API calls: **0**. Custom model training runs: **0**. Local computation and researcher time still have costs.

The recorded run took about 3.97 seconds including index construction and all queries. Query scoring/sorting averaged 11.18 ms locally, with a local p95 of 18.97 ms. These are one-process observations, excluding a deployed API, source access, authorization, updates, and network latency. They are not a production latency commitment.

A separate JavaScript implementation recomputed all five metrics for every query using gold-document rank lookup instead of scanning retrieved hits. It agreed within `1e-12` on **1,500 query-level values and five aggregate values**. Seven boundary/validation fixtures cover a perfect result, missing relevant documents, rank two, cutoff positions, an empty ranking, duplicate IDs, and absent gold labels. This reduces arithmetic errors from tests written alongside the runner. It is not an independent validation of BM25 rankings or dataset representativeness. Metric conventions were checked against the [BEIR evaluator](https://raw.githubusercontent.com/beir-cellar/beir/main/beir/retrieval/evaluation.py).

Artifacts: [runner](../benchmarks/scifact_bm25.py), [rankings and run manifest](../benchmarks/scifact-bm25-results.json), [metric verification report](../benchmarks/metric-verification.json). The source dataset remains in temporary storage, outside the project. Derived relevance records retain their dataset attribution and license reference; no document text is redistributed here.

**Interpretation:** this establishes a reproducible lexical baseline that another retrieval offer can be compared against. It supplies no evidence that a particular hosted or downloadable model is better, that an MCP connector works, or that a company will successfully adopt it. There are no comparative model results yet.

## 4. Three distinct tests before a probability claim

1. **Public capability benchmark:** pin dataset revision/hash, labels, preprocessing, metric definitions, candidate model/version, prompt where applicable, and output schema. Preserve failures and abstentions. Use paired queries/documents across comparable offers. Keep a tuning split separate from final evaluation. Tag known contamination and domain limits.
2. **Actual connector and deployment tests:** exercise the real tool or inference interface, authentication, schema mapping, timeouts, metering, retries, cancellation, and budget limits. For retrieval, test two principals with different permissions, denied access, revocation, deletion, stale copies, and returned-source provenance. Test hosted and company-run offers independently. Public relevance tests cannot replace these checks.
3. **Company acceptance attempts:** use an authorized representative workload, agreed output requirements, deployment context, cost/deadline limits, and approved evaluator. Freeze the policy before the attempt. Record independent attempt outcomes with traceable evidence and actual paid/retained costs. These are the appropriate observations for adoption `P_outcome` under that policy.

Repeated executions of the same query or attempt are not additional independent customers. Group shared documents, customers, templates, and other correlated units when constructing splits and reporting uncertainty. Do not insert all benchmark queries into the adoption success/failure counter. Public capability evidence, deployment conformance, and whole-attempt acceptance need distinct evidence types.

For binary tests, more examples must be tied to a claim. With zero observed failures, a one-sided exact 95% upper failure-rate bound is `1 - 0.05^(1/n)`, assuming independent representative trials for one frozen profile. Bounding failure at 5%, 1%, or 0.1% requires at least **59, 299, or 2,995** such trials respectively. This is a sample-planning result, not a guarantee or a Bayesian prior. Rare classes and simultaneous claims need separate treatment. [NIST exact binomial interval method](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).

## 5. Cost measurements and hosted/private execution

Compare offers only for the same business job and workload horizon. A document parser's billing unit cannot establish that it is cheaper than a search embedding service. Published prices are components; measured costs must include the pipeline and company effort.

Published component prices checked October 9, 2026:

- Google Document AI's invoice parser bills $0.10 for each document of up to ten pages, with additional ten-page document ranges billed separately. Thus 300 short documents have a $30 parser list-price component before credits, review, storage, and integration. This is arithmetic from published pricing, not an executed invoice benchmark. [Document AI pricing](https://cloud.google.com/products/document-ai/pricing).
- Voyage lists `voyage-4-lite` at $0.02 per million tokens, with an introductory free allowance. Embeddings alone exclude search indexing, source connectors, permission enforcement, updates, reranking, and generation. The allowance is not a permanent business-cost assumption. [Voyage pricing](https://docs.voyageai.com/docs/pricing).
- Hugging Face's `hf-inference` charges from compute time and hardware cost after applicable credits. There is no universal classification price per ticket in that pricing rule. Obtain the actual model/provider quote and measure the workload. [Inference provider pricing](https://huggingface.co/docs/inference-providers/en/pricing).

Hosted offers need model/provider revision, data retention and region terms, permitted commercial use, quotas, actual token/compute charges, provider availability, and refundable versus consumed charges. Company-run offers need compatible model artifacts and license, CPU/GPU/RAM requirements, load/installation time, runtime cost, telemetry behavior, local configuration, and ongoing maintenance. Access to weights is not proof that a company can operate them within its budget. Do not share adoption evidence between these execution contexts merely because their weights match.

Examples of available pretrained supply include a local retrieval embedding model, a zero-shot classification model, and a document-parsing model. Their cards establish possible starting points, not comparative performance or complete business connectors. Document parsing still requires mapping to an invoice acceptance schema. [BGE small model card](https://huggingface.co/BAAI/bge-small-en-v1.5), [zero-shot classifier card](https://huggingface.co/MoritzLaurer/deberta-v3-base-zeroshot-v1.1-all-33), [PaddleOCR model card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6).

For each attempt retain a cost ledger: purchase retained/refunded, consumed inference, ingestion/update/indexing, evaluator and review, deployment effort, buyer-paid chain expense, and fallback loss. Feed those measurements into the existing `C_reuse` equation. Measure LemmaX's own evaluation/storage/settlement costs separately for its contribution margin. Low model API prices do not establish a viable margin by themselves.

## 6. What this means for the four-day decision

The evidence supports different conclusions, rather than one universal winner:

- Extraction has the strongest quantified workflow savings among the sources reviewed. Its representative labeled documents and field-to-business mapping are unresolved access and evaluation work.
- Classification has the most bounded output and immediately available labeled test data. Company taxonomy transfer, rare-class errors, and differentiation from incumbent products remain unresolved.
- Retrieval best matches the connector/MCP direction and now has an executed inexpensive public baseline. Enterprise permission/freshness behavior and company-specific relevance remain untested.

**Proposed next decision:** freeze a benchmark and acceptance profile for one narrow capability. Retrieval's candidate boundary is `authorized ranked source retrieval`, with answer generation outside that profile. It is a feasibility candidate, not a confirmed business winner. A decision to ship it should depend on executable connector tests and comparable offers, not on the tentative knowledge base or its baseline score alone.

The selection gate is concrete: usable data and rights; one explicit buyer output; at least two comparable versioned offers; an evaluator that can execute within the remaining time and budget; measured connector behavior; a cost ledger; and a demonstration of the existing private commitment/settlement flow. If these cannot be achieved for a candidate, narrow the demonstrated claim or test the next candidate. Do not fabricate an adoption probability to fill the catalog.

For the hackathon, a credible outcome is a small evidence-backed directory, deterministic assessment API, approved-evaluator verdict, and Monad commitment/settlement. Public benchmarks can remain offchain. No training pipeline, agentic planning, zkML proof generation, FHE processing, Ethereum blob publishing, or broad connector suite is necessary to establish this first demonstration.

## 7. Verification and unresolved requirements

Measured: one lexical retrieval baseline and its metric arithmetic. Published evidence: named buyer workflows, dataset availability/licensing, and provider price components. Proposed: the acceptance boundaries, additional tests, and selection gate. Unknown: actual LemmaX demand, company workloads, candidate model quality, live MCP behavior, hosted/private full costs, and refund economics.

No defects were found in the metric comparison. No extraction/classification benchmark, live connector test, model comparison, customer pilot, contract deployment, settlement test, or economic validation was completed in this research step. The knowledge base mentioned in conversation is not treated as an authorized or trusted dataset.
