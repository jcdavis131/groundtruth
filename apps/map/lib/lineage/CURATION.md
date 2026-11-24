# Method Lineage seed — curation notes (SPEC C3.1, C3.5)

Every paper's metadata (title, authors, year, arXiv id, abstract) comes from
the arXiv export API, publisher "arXiv.org e-Print archive", metadata licence
CC0 1.0. No paper, year, quote or node was invented. Every edge quote is a
verbatim substring of its `to` paper's abstract, verified at build time by
`scripts/lineage-seed-fetch.mjs` and again by `lib/lineage/validate.mjs`.

**Backing file path and entry count: UNLOCATED as of 2026-11-23.** The
`/research/[slug]` knowledge-map store has no located backing file, so the
idle importer (`lib/lineage/importers/knowledge-map.mjs`) is never run in the
build. This line is amended when Cameron names the store.

Venue tier: tier1 = NeurIPS/ICML/ICLR/ACL/CVPR/JMLR publication of record;
tier2 = everything else. Each venue was verified against the paper's own
`journal-ref`/comments field or the venue's proceedings page; a paper with no
verified venue is tier2 with venue "arXiv preprint".

## Notes on judgement calls

- **SGD year is 1951.** The method dates to Robbins-Monro (1951). Its
  defining paper here is Ruder's 2016 overview (arXiv:1609.04747) because no
  arXiv record of the 1951 original exists; the embedded paper's `releasedAt`
  is 2016. Edge year-order uses the method year 1951, so `sgd -> adam` and
  `sgd -> adadelta` are valid.
- **MHA shares the Transformer paper.** `mha` and `attention-2017` both cite
  arXiv:1706.03762, so the seed has 60 method nodes but 59 paper nodes.
- **`qat -> gptq` is `compares` (weak).** GPTQ is one-shot post-training
  quantization, a different approach from training-based QAT — not an
  improvement on QAT's mechanism.
- **`gqa -> kivi` is the single cross-lineage edge (`adapts`).** KV-cache
  efficiency is the shared bottleneck: GQA shrinks the cache by sharing
  key-value heads, KIVI shrinks it by quantizing the cache.
- **Axes.** The 14-axis `BottleneckAxis` enum is copied from the Intern-Atlas
  paper arXiv:2604.28158, Table 4. One axis per edge.
- **Corrected arXiv ids.** Ten remembered ids were wrong on first probe and
  were corrected against the live API before curation: RetNet 2304.01062 ->
  2307.08621, Sophia 2305.14341 -> 2305.14342, RMSNorm 1910.07430 ->
  1910.07467, FRN 1908.01418 -> 1911.09737, HAWQ 1901.03684 -> 1905.03696,
  LLM.int8() 2208.11526 -> 2208.07339, Jacob QAT 1809.07032 -> 1712.05877,
  QuIP 2304.13771 -> 2307.13304, AQLM 2401.06112 -> 2401.06118, KIVI
  2402.05099 -> 2402.02750. (RetNet was then cut; see below.)

## Cut, not included

- AdaGrad: no arXiv record of the original paper was found.
- Momentum (Polyak 1964): predates arXiv; a paperless node cannot carry
  verbatim edge quotes, so it was dropped rather than faked.
- IA3, DeepNorm, InstanceNorm, RetNet, Hyena, Ring Attention, ZeroQuant: cut
  to hold the 40-60 method range.

## 1. Attention efficiency (15 methods)

Ordered by the chain attention-2017 -> mha -> mqa -> gqa, with
flash-attention -> flash-attention-2 beside it; the sparse/linear family
branches off attention-2017.

| Method | Defining paper | Venue (tier) | Why |
|---|---|---|---|
| attention-2017 | Attention Is All You Need, 1706.03762 | NeurIPS 2017 (tier1) | Root: attention replaces recurrence and convolution |
| mha | Attention Is All You Need, 1706.03762 | NeurIPS 2017 (tier1) | The multi-head mechanism the chain refines |
| sparse-transformer | Generating Long Sequences with Sparse Transformers, 1904.10509 | arXiv preprint (tier2) | First sparse factorization of the attention matrix |
| reformer | Reformer: The Efficient Transformer, 2001.04451 | ICLR 2020 (tier1) | LSH attention, O(L log L), reversible layers |
| longformer | Longformer: The Long-Document Transformer, 2004.05150 | arXiv preprint (tier2) | Local + global attention, linear in length |
| bigbird | Big Bird: Transformers for Longer Sequences, 2007.14062 | NeurIPS 2020 (tier1) | Sparse attention with global tokens, universal approximator |
| linformer | Linformer: Self-Attention with Linear Complexity, 2006.04768 | arXiv preprint (tier2) | Low-rank approximation, O(n) time and space |
| performer | Rethinking Attention with Performers, 2009.14794 | ICLR 2021 (tier1) | FAVOR+ kernel attention, linear without sparsity or low-rank priors |
| mqa | Fast Transformer Decoding, 1911.02150 | arXiv preprint (tier2) | One key-value head: faster decoding, less memory bandwidth |
| gqa | GQA, 2305.13245 | EMNLP 2023 (tier2) | Grouped heads: MQA speed near MHA quality |
| flash-attention | FlashAttention, 2205.14135 | NeurIPS 2022 (tier1) | IO-aware exact attention, tiling across GPU memory levels |
| flash-attention-2 | FlashAttention-2, 2307.08691 | ICLR 2024 (tier1) | Better work partitioning, near-GEMM efficiency |
| mamba | Mamba, 2312.00752 | COLM 2024 (tier2) | Selective state spaces: linear time without attention |
| mla | DeepSeek-V2, 2405.04434 | arXiv preprint (tier2) | Latent KV cache: 93.3% smaller cache |
| nsa | Native Sparse Attention, 2502.11089 | arXiv preprint (tier2) | Hardware-aligned natively trainable sparse attention |

## 2. Optimisers (9 methods)

Ordered sgd -> adam -> adamw, with adadelta, adafactor, lamb, shampoo off
adam and lion, sophia off adamw.

| Method | Defining paper | Venue (tier) | Why |
|---|---|---|---|
| sgd | An overview of gradient descent optimization algorithms, 1609.04747 | arXiv preprint (tier2) | Root: the overview stands in for the 1951 original (see note) |
| adam | Adam: A Method for Stochastic Optimization, 1412.6980 | ICLR 2015 (tier1) | Adaptive moments; the default optimiser the rest refine |
| adamw | Decoupled Weight Decay Regularization, 1711.05101 | ICLR 2019 (tier1) | Decoupled weight decay restores Adam's generalisation |
| adadelta | ADADELTA: An Adaptive Learning Rate Method, 1212.5701 | arXiv preprint (tier2) | Per-dimension rates with no manual learning rate |
| adafactor | Adafactor, 1804.04235 | ICML 2018 (tier1) | Sublinear memory: row/column second-moment sums |
| lamb | Large Batch Optimization for Deep Learning, 1904.00962 | ICLR 2020 (tier1) | Layerwise adaptation for very large batches (BERT in 76 min) |
| shampoo | Shampoo, 1802.09568 | arXiv preprint (tier2) | Structure-aware preconditioning over tensor spaces |
| lion | Symbolic Discovery of Optimization Algorithms, 2302.06675 | arXiv preprint (tier2) | Sign momentum: Adam's memory, uniform update magnitude |
| sophia | Sophia, 2305.14342 | arXiv preprint (tier2) | Diagonal-Hessian second-order optimiser at Adam-like cost |

## 3. Normalisation (10 methods)

Ordered batchnorm -> layernorm -> rmsnorm, with groupnorm, weightnorm,
spectral-norm, batch-renorm, frn, nfnet off batchnorm and dyt off layernorm.

| Method | Defining paper | Venue (tier) | Why |
|---|---|---|---|
| batchnorm | Batch Normalization, 1502.03167 | ICML 2015 (tier1) | Root: normalise layer inputs per mini-batch |
| layernorm | Layer Normalization, 1607.06450 | arXiv preprint (tier2) | Per-example statistics: works for RNNs, batch-size free |
| rmsnorm | Root Mean Square Layer Normalization, 1910.07467 | NeurIPS 2019 (tier1) | Drops re-centering: same stability, 7-64% faster |
| groupnorm | Group Normalization, 1803.08494 | ECCV 2018 (tier2) | Channel groups: batch-size independent, stable at batch 2 |
| weightnorm | Weight Normalization, 1602.07868 | NeurIPS 2016 (tier1) | Decouples weight length from direction, no batch dependence |
| spectral-norm | Spectral Normalization for GANs, 1802.05957 | ICLR 2018 (tier1) | Stabilises the GAN discriminator by construction |
| batch-renorm | Batch Renormalization, 1702.03275 | NeurIPS 2017 (tier1) | Same train/inference outputs for small or non-i.i.d. batches |
| nfnet | High-Performance Large-Scale Image Recognition Without Normalization, 2102.06171 | arXiv preprint (tier2) | Normaliser-free ResNets via adaptive gradient clipping |
| dyt | Transformers without Normalization, 2503.10622 | CVPR 2025 (tier1) | Dynamic Tanh replaces normalisation layers outright |
| frn | Filter Response Normalization Layer, 1911.09737 | CVPR 2020 (tier1) | Per-channel normalisation + activation, no batch dependence |

## 4. Parameter-efficient fine-tuning (13 methods)

Ordered full-finetuning -> adapters -> lora, with prefix-tuning,
prompt-tuning, p-tuning-v2, bitfit, compacter, qlora, adalora, dora, pissa,
vera branching off.

| Method | Defining paper | Venue (tier) | Why |
|---|---|---|---|
| full-finetuning | BERT, 1810.04805 | NAACL 2019 (tier2) | Root: retrain every parameter per task |
| adapters | Parameter-Efficient Transfer Learning for NLP, 1902.00751 | ICML 2019 (tier1) | Small task modules, frozen base, 3.6% parameters per task |
| prefix-tuning | Prefix-Tuning, 2101.00190 | ACL 2021 (tier1) | Frozen model + learned continuous prefix, 0.1% parameters |
| prompt-tuning | The Power of Scale for Parameter-Efficient Prompt Tuning, 2104.08691 | EMNLP 2021 (tier2) | Soft prompts; closes the gap to full tuning at scale |
| lora | LoRA, 2106.09685 | ICLR 2022 (tier1) | Frozen weights + low-rank updates, no inference latency |
| qlora | QLoRA, 2305.14314 | NeurIPS 2023 (tier1) | LoRA through a frozen 4-bit model: 65B on one 48GB GPU |
| adalora | AdaLoRA, 2303.10512 | ICLR 2023 (tier1) | Budget allocated by weight importance, SVD-pruned |
| bitfit | BitFit, 2106.10199 | ACL 2022 (tier1) | Bias terms only: the sparsest fine-tune that still works |
| dora | DoRA, 2402.09353 | ICML 2024 (tier1) | Magnitude + direction decomposition closes the FT gap |
| pissa | PiSSA, 2404.02948 | NeurIPS 2024 (tier1) | Principal components as the LoRA init: faster convergence |
| vera | VeRA, 2310.11454 | ICLR 2024 (tier1) | Shared random matrices + learned scaling vectors |
| p-tuning-v2 | P-Tuning v2, 2110.07602 | ACL 2022 (tier1) | Deep prompt tuning made universal across NLU scales/tasks |
| compacter | Compacter, 2106.04647 | NeurIPS 2021 (tier1) | Kronecker hypercomplex adapters: 0.047% parameters |

## 5. Quantisation (13 methods)

Ordered binaryconnect -> xnor-net -> qat, with hawq, llm-int8, gptq off qat
and awq, smoothquant, spqr, quip, squeezellm, aqlm, kivi downstream.

| Method | Defining paper | Venue (tier) | Why |
|---|---|---|---|
| qat | Quantization and Training of Neural Networks for Efficient Integer-Arithmetic-Only Inference, 1712.05877 | CVPR 2018 (tier1) | Root: integer-only inference with accuracy preserved |
| binaryconnect | BinaryConnect, 1511.00363 | NeurIPS 2015 (tier1) | Binary weights during propagation; multiplies become adds |
| xnor-net | XNOR-Net, 1603.05279 | ECCV 2016 (tier2) | Binary weights and inputs: 58x faster convolutions |
| hawq | HAWQ, 1905.03696 | ICCV 2019 (tier2) | Hessian-aware mixed precision per layer |
| llm-int8 | LLM.int8(), 2208.07339 | NeurIPS 2022 (tier1) | 8-bit matmul for LLMs: half the memory, no degradation |
| gptq | GPTQ, 2210.17323 | ICLR 2023 (tier1) | One-shot 3-4 bit weights from second-order information |
| awq | AWQ, 2306.00978 | MLSys 2024 (tier2) | Protect 1% salient weights: activation-aware quantisation |
| smoothquant | SmoothQuant, 2211.10438 | ICML 2023 (tier1) | Migrate activation outliers to weights: W8A8 that holds |
| spqr | SpQR, 2306.03078 | arXiv preprint (tier2) | Sparse-quantized: outlier weights kept in higher precision |
| quip | QuIP, 2307.13304 | NeurIPS 2023 (tier1) | Incoherence processing: viable 2-bit quantisation |
| squeezellm | SqueezeLLM, 2306.07629 | ICML 2024 (tier1) | Sensitivity-based non-uniform + dense-and-sparse 3-bit |
| kivi | KIVI, 2402.02750 | ICML 2024 (tier1) | Tuning-free asymmetric 2-bit KV-cache quantisation |
| aqlm | Extreme Compression of LLMs via Additive Quantization, 2401.06118 | ICML 2024 (tier1) | Multi-codebook additive quantisation, Pareto-optimal under 3 bits |
