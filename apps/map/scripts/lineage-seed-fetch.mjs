// Build-time seed fetch for the Method Lineage graph (SPEC C3.1, C3.2).
// Fetches paper metadata (title, authors, abstract, published date) from
// the arXiv export API — keyless, one request per 3 s, batches of at most
// 10 ids — and writes lib/lineage/graph.json. Run from apps/map:
//   node scripts/lineage-seed-fetch.mjs
// The curation below (methods, venues/tiers, edges, verbatim quotes) is
// the seed; the API supplies only the paper metadata. Every edge quote is
// verified inline against the fetched abstract and dropped with a reason
// when it does not match — never fuzzed, never invented.
// This file names export.arxiv.org, which is why hosts.allow.json carries
// that entry (kind request, build-time seed metadata only).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://export.arxiv.org/api/query?id_list=";
const PACE_MS = 3100; // arXiv API Terms of Use: at most one request every three seconds.
const BATCH_SIZE = 10;
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "lineage",
  "graph.json",
);

// ---------------------------------------------------------------------------
// Curated methods: id, name, aliases, year, arXiv id, venue, tier, parent.
// year is the METHOD's origin year (SGD is 1951, Robbins-Monro; its defining
// paper here is the 2016 Ruder overview — see CURATION.md). Venue tier is
// tier1 = NeurIPS/ICML/ICLR/ACL/CVPR/JMLR publication of record, else tier2;
// each venue was verified against the paper's journal-ref/comments field or
// the venue's proceedings page (see CURATION.md for the per-paper source).
// ---------------------------------------------------------------------------
const METHODS = [
  // Attention efficiency (15).
  { id: "attention-2017", name: "Transformer (scaled dot-product attention)", aliases: ["attention", "transformer"], year: 2017, arxivId: "1706.03762", venue: "NeurIPS 2017", tier: "tier1" },
  { id: "mha", name: "Multi-head attention", aliases: ["MHA"], year: 2017, arxivId: "1706.03762", venue: "NeurIPS 2017", tier: "tier1", parent: "attention-2017" },
  { id: "sparse-transformer", name: "Sparse Transformer", aliases: [], year: 2019, arxivId: "1904.10509", venue: "arXiv preprint", tier: "tier2", parent: "attention-2017" },
  { id: "reformer", name: "Reformer", aliases: [], year: 2020, arxivId: "2001.04451", venue: "ICLR 2020", tier: "tier1", parent: "attention-2017" },
  { id: "longformer", name: "Longformer", aliases: [], year: 2020, arxivId: "2004.05150", venue: "arXiv preprint", tier: "tier2", parent: "attention-2017" },
  { id: "bigbird", name: "Big Bird", aliases: [], year: 2020, arxivId: "2007.14062", venue: "NeurIPS 2020", tier: "tier1", parent: "attention-2017" },
  { id: "linformer", name: "Linformer", aliases: [], year: 2020, arxivId: "2006.04768", venue: "arXiv preprint", tier: "tier2", parent: "attention-2017" },
  { id: "performer", name: "Performer", aliases: [], year: 2020, arxivId: "2009.14794", venue: "ICLR 2021", tier: "tier1", parent: "attention-2017" },
  { id: "mqa", name: "Multi-query attention", aliases: ["MQA"], year: 2019, arxivId: "1911.02150", venue: "arXiv preprint", tier: "tier2", parent: "mha" },
  { id: "gqa", name: "Grouped-query attention", aliases: ["GQA"], year: 2023, arxivId: "2305.13245", venue: "EMNLP 2023", tier: "tier2", parent: "mqa" },
  { id: "flash-attention", name: "FlashAttention", aliases: ["FlashAttention-1"], year: 2022, arxivId: "2205.14135", venue: "NeurIPS 2022", tier: "tier1", parent: "mha" },
  { id: "flash-attention-2", name: "FlashAttention-2", aliases: [], year: 2023, arxivId: "2307.08691", venue: "ICLR 2024", tier: "tier1", parent: "flash-attention" },
  { id: "mamba", name: "Mamba", aliases: ["selective state space model"], year: 2023, arxivId: "2312.00752", venue: "COLM 2024", tier: "tier2", parent: "attention-2017" },
  { id: "mla", name: "Multi-head Latent Attention", aliases: ["MLA"], year: 2024, arxivId: "2405.04434", venue: "arXiv preprint", tier: "tier2", parent: "attention-2017" },
  { id: "nsa", name: "Native Sparse Attention", aliases: ["NSA"], year: 2025, arxivId: "2502.11089", venue: "arXiv preprint", tier: "tier2", parent: "attention-2017" },
  // Optimisers (9).
  { id: "sgd", name: "Stochastic gradient descent", aliases: ["SGD"], year: 1951, arxivId: "1609.04747", venue: "arXiv preprint", tier: "tier2" },
  { id: "adam", name: "Adam", aliases: [], year: 2014, arxivId: "1412.6980", venue: "ICLR 2015", tier: "tier1", parent: "sgd" },
  { id: "adamw", name: "AdamW", aliases: [], year: 2017, arxivId: "1711.05101", venue: "ICLR 2019", tier: "tier1", parent: "adam" },
  { id: "adadelta", name: "AdaDelta", aliases: [], year: 2012, arxivId: "1212.5701", venue: "arXiv preprint", tier: "tier2", parent: "sgd" },
  { id: "adafactor", name: "Adafactor", aliases: [], year: 2018, arxivId: "1804.04235", venue: "ICML 2018", tier: "tier1", parent: "adam" },
  { id: "lamb", name: "LAMB", aliases: [], year: 2019, arxivId: "1904.00962", venue: "ICLR 2020", tier: "tier1", parent: "adam" },
  { id: "shampoo", name: "Shampoo", aliases: [], year: 2018, arxivId: "1802.09568", venue: "arXiv preprint", tier: "tier2", parent: "adam" },
  { id: "lion", name: "Lion", aliases: [], year: 2023, arxivId: "2302.06675", venue: "arXiv preprint", tier: "tier2", parent: "adamw" },
  { id: "sophia", name: "Sophia", aliases: [], year: 2023, arxivId: "2305.14342", venue: "arXiv preprint", tier: "tier2", parent: "adamw" },
  // Normalisation (10).
  { id: "batchnorm", name: "Batch Normalization", aliases: ["BatchNorm", "BN"], year: 2015, arxivId: "1502.03167", venue: "ICML 2015", tier: "tier1" },
  { id: "layernorm", name: "Layer Normalization", aliases: ["LayerNorm", "LN"], year: 2016, arxivId: "1607.06450", venue: "arXiv preprint", tier: "tier2", parent: "batchnorm" },
  { id: "rmsnorm", name: "RMSNorm", aliases: [], year: 2019, arxivId: "1910.07467", venue: "NeurIPS 2019", tier: "tier1", parent: "layernorm" },
  { id: "groupnorm", name: "Group Normalization", aliases: ["GroupNorm", "GN"], year: 2018, arxivId: "1803.08494", venue: "ECCV 2018", tier: "tier2", parent: "layernorm" },
  { id: "weightnorm", name: "Weight Normalization", aliases: ["WeightNorm"], year: 2016, arxivId: "1602.07868", venue: "NeurIPS 2016", tier: "tier1", parent: "batchnorm" },
  { id: "spectral-norm", name: "Spectral Normalization", aliases: ["SpectralNorm"], year: 2018, arxivId: "1802.05957", venue: "ICLR 2018", tier: "tier1", parent: "batchnorm" },
  { id: "batch-renorm", name: "Batch Renormalization", aliases: ["BatchRenorm"], year: 2017, arxivId: "1702.03275", venue: "NeurIPS 2017", tier: "tier1", parent: "batchnorm" },
  { id: "nfnet", name: "Normalizer-Free ResNet", aliases: ["NFNet"], year: 2021, arxivId: "2102.06171", venue: "arXiv preprint", tier: "tier2", parent: "batchnorm" },
  { id: "dyt", name: "Dynamic Tanh", aliases: ["DyT"], year: 2025, arxivId: "2503.10622", venue: "CVPR 2025", tier: "tier1", parent: "layernorm" },
  { id: "frn", name: "Filter Response Normalization", aliases: ["FRN"], year: 2019, arxivId: "1911.09737", venue: "CVPR 2020", tier: "tier1", parent: "batchnorm" },
  // Parameter-efficient fine-tuning (13).
  { id: "full-finetuning", name: "Full fine-tuning", aliases: ["full FT"], year: 2018, arxivId: "1810.04805", venue: "NAACL 2019", tier: "tier2" },
  { id: "adapters", name: "Adapters", aliases: [], year: 2019, arxivId: "1902.00751", venue: "ICML 2019", tier: "tier1", parent: "full-finetuning" },
  { id: "prefix-tuning", name: "Prefix-tuning", aliases: [], year: 2021, arxivId: "2101.00190", venue: "ACL 2021", tier: "tier1", parent: "adapters" },
  { id: "prompt-tuning", name: "Prompt tuning", aliases: [], year: 2021, arxivId: "2104.08691", venue: "EMNLP 2021", tier: "tier2", parent: "prefix-tuning" },
  { id: "lora", name: "LoRA", aliases: ["Low-Rank Adaptation"], year: 2021, arxivId: "2106.09685", venue: "ICLR 2022", tier: "tier1", parent: "adapters" },
  { id: "qlora", name: "QLoRA", aliases: [], year: 2023, arxivId: "2305.14314", venue: "NeurIPS 2023", tier: "tier1", parent: "lora" },
  { id: "adalora", name: "AdaLoRA", aliases: [], year: 2023, arxivId: "2303.10512", venue: "ICLR 2023", tier: "tier1", parent: "lora" },
  { id: "bitfit", name: "BitFit", aliases: [], year: 2021, arxivId: "2106.10199", venue: "ACL 2022", tier: "tier1", parent: "full-finetuning" },
  { id: "dora", name: "DoRA", aliases: [], year: 2024, arxivId: "2402.09353", venue: "ICML 2024", tier: "tier1", parent: "lora" },
  { id: "pissa", name: "PiSSA", aliases: [], year: 2024, arxivId: "2404.02948", venue: "NeurIPS 2024", tier: "tier1", parent: "lora" },
  { id: "vera", name: "VeRA", aliases: [], year: 2023, arxivId: "2310.11454", venue: "ICLR 2024", tier: "tier1", parent: "lora" },
  { id: "p-tuning-v2", name: "P-Tuning v2", aliases: [], year: 2021, arxivId: "2110.07602", venue: "ACL 2022", tier: "tier1", parent: "prompt-tuning" },
  { id: "compacter", name: "Compacter", aliases: [], year: 2021, arxivId: "2106.04647", venue: "NeurIPS 2021", tier: "tier1", parent: "adapters" },
  // Quantisation (13).
  { id: "qat", name: "Quantization-aware training", aliases: ["QAT", "integer-only inference"], year: 2017, arxivId: "1712.05877", venue: "CVPR 2018", tier: "tier1" },
  { id: "binaryconnect", name: "BinaryConnect", aliases: [], year: 2015, arxivId: "1511.00363", venue: "NeurIPS 2015", tier: "tier1" },
  { id: "xnor-net", name: "XNOR-Net", aliases: [], year: 2016, arxivId: "1603.05279", venue: "ECCV 2016", tier: "tier2", parent: "binaryconnect" },
  { id: "hawq", name: "HAWQ", aliases: [], year: 2019, arxivId: "1905.03696", venue: "ICCV 2019", tier: "tier2", parent: "qat" },
  { id: "llm-int8", name: "LLM.int8()", aliases: [], year: 2022, arxivId: "2208.07339", venue: "NeurIPS 2022", tier: "tier1", parent: "qat" },
  { id: "gptq", name: "GPTQ", aliases: [], year: 2022, arxivId: "2210.17323", venue: "ICLR 2023", tier: "tier1", parent: "qat" },
  { id: "awq", name: "AWQ", aliases: [], year: 2023, arxivId: "2306.00978", venue: "MLSys 2024", tier: "tier2", parent: "gptq" },
  { id: "smoothquant", name: "SmoothQuant", aliases: [], year: 2022, arxivId: "2211.10438", venue: "ICML 2023", tier: "tier1", parent: "llm-int8" },
  { id: "spqr", name: "SpQR", aliases: [], year: 2023, arxivId: "2306.03078", venue: "arXiv preprint", tier: "tier2", parent: "gptq" },
  { id: "quip", name: "QuIP", aliases: [], year: 2023, arxivId: "2307.13304", venue: "NeurIPS 2023", tier: "tier1", parent: "gptq" },
  { id: "squeezellm", name: "SqueezeLLM", aliases: [], year: 2023, arxivId: "2306.07629", venue: "ICML 2024", tier: "tier1", parent: "gptq" },
  { id: "kivi", name: "KIVI", aliases: [], year: 2024, arxivId: "2402.02750", venue: "ICML 2024", tier: "tier1", parent: "smoothquant" },
  { id: "aqlm", name: "AQLM", aliases: [], year: 2024, arxivId: "2401.06118", venue: "ICML 2024", tier: "tier1", parent: "gptq" },
];

// ---------------------------------------------------------------------------
// Curated edges: [from, to, type, axis, bottleneck, mechanism, tradeoff|null].
// Every quote is a verbatim substring of the TO paper's abstract (locator
// "abstract"), copied from the arXiv record — never paraphrased, never
// invented. Quotes avoid LaTeX and special characters so they survive the
// case/whitespace normalisation in validate.mjs. tradeoff null → confidence
// 0.8; all three quotes validating → confidence 1.0 (SPEC C3.2).
// ---------------------------------------------------------------------------
const EDGES = [
  // Attention efficiency (25).
  ["attention-2017", "mha", "extends", "parallelization", "complex recurrent or convolutional neural networks", "based solely on attention mechanisms", null],
  ["attention-2017", "sparse-transformer", "extends", "computational complexity", "require time and memory that grows quadratically with the sequence length", "sparse factorizations of the attention matrix", "the recomputation of attention matrices to save memory"],
  ["attention-2017", "reformer", "improves", "memory efficiency", "training these models can be prohibitively costly", "we replace dot-product attention by one that uses locality-sensitive hashing", null],
  ["attention-2017", "longformer", "extends", "scalability", "Transformer-based models are unable to process long sequences", "an attention mechanism that scales linearly with sequence length", null],
  ["attention-2017", "bigbird", "extends", "memory efficiency", "one of their core limitations is the quadratic dependency (mainly in terms of memory) on the sequence length", "a sparse attention mechanism that reduces this quadratic dependency to linear", null],
  ["attention-2017", "linformer", "improves", "computational complexity", "training and deploying these models can be prohibitively costly for long sequences", "the self-attention mechanism can be approximated by a low-rank matrix", null],
  ["attention-2017", "performer", "improves", "computational complexity", "beyond the reach of regular Transformers", "using only linear (as opposed to quadratic) space and time complexity", null],
  ["attention-2017", "mamba", "compares", "computational complexity", "to address Transformers' computational inefficiency on long sequences", "letting the SSM parameters be functions of the input", "they have not performed as well as attention on important modalities such as language"],
  ["attention-2017", "mla", "improves", "memory efficiency", "characterized by economical training and efficient inference", "significantly compressing the Key-Value (KV) cache into a latent vector", null],
  ["attention-2017", "nsa", "improves", "computational complexity", "the high computational cost of standard attention mechanisms poses significant computational challenges", "a Natively trainable Sparse Attention mechanism", null],
  ["mha", "mqa", "improves", "memory efficiency", "is often slow, due to the memory-bandwidth cost of repeatedly loading the large", "the keys and values are shared across all of the different attention", "incur only minor quality degradation from the baseline"],
  ["mqa", "gqa", "improves", "accuracy", "However, MQA can lead to quality degradation", "introduce grouped-query attention (GQA), a generalization of multi-query attention", null],
  ["mha", "flash-attention", "improves", "inference speed", "Transformers are slow and memory-hungry on long sequences", "an IO-aware exact attention algorithm that uses tiling to reduce the number of memory reads/writes", null],
  ["flash-attention", "flash-attention-2", "improves", "parallelization", "FlashAttention is still not nearly as fast as optimized matrix-multiply (GEMM) operations", "parallelize the attention computation, even for a single head, across different thread blocks", null],
  ["sparse-transformer", "longformer", "extends", "scalability", "Transformer-based models are unable to process long sequences", "combines a local windowed attention with a task motivated global attention", null],
  ["reformer", "performer", "compares", "computational complexity", "beyond the reach of regular Transformers", "Performers use a novel Fast Attention Via positive Orthogonal Random features approach", "without relying on any priors such as sparsity or low-rankness"],
  ["linformer", "performer", "compares", "computational complexity", "beyond the reach of regular Transformers", "Performers use a novel Fast Attention Via positive Orthogonal Random features approach", "without relying on any priors such as sparsity or low-rankness"],
  ["longformer", "bigbird", "extends", "scalability", "one of their core limitations is the quadratic dependency (mainly in terms of memory) on the sequence length", "a sparse attention mechanism that reduces this quadratic dependency to linear", null],
  ["sparse-transformer", "reformer", "compares", "memory efficiency", "training these models can be prohibitively costly", "which allows storing activations only once in the training process", null],
  ["mqa", "mla", "improves", "memory efficiency", "characterized by economical training and efficient inference", "significantly compressing the Key-Value (KV) cache into a latent vector", null],
  ["mha", "mla", "improves", "memory efficiency", "characterized by economical training and efficient inference", "significantly compressing the Key-Value (KV) cache into a latent vector", null],
  ["longformer", "nsa", "improves", "computational complexity", "the high computational cost of standard attention mechanisms poses significant computational challenges", "combining coarse-grained token compression with fine-grained token selection", null],
  ["mamba", "mla", "compares", "memory efficiency", "reduces the KV cache by 93.3%", "significantly compressing the Key-Value (KV) cache into a latent vector", null],
  ["sparse-transformer", "bigbird", "compares", "scalability", "one of their core limitations is the quadratic dependency (mainly in terms of memory) on the sequence length", "a sparse attention mechanism that reduces this quadratic dependency to linear", null],
  ["reformer", "longformer", "compares", "scalability", "Transformer-based models are unable to process long sequences", "combines a local windowed attention with a task motivated global attention", null],
  // Optimisers (12).
  ["sgd", "adam", "improves", "training stability", "problems with very noisy and/or sparse gradients", "based on adaptive estimates of lower-order moments", null],
  ["sgd", "adadelta", "improves", "hyperparameter sensitivity", "requires no manual tuning of a learning rate", "dynamically adapts over time using only first order information", null],
  ["adadelta", "adam", "improves", "training stability", "problems with very noisy and/or sparse gradients", "based on adaptive estimates of lower-order moments", null],
  ["adam", "adamw", "improves", "generalization", "allowing it to compete with SGD with momentum on image classification datasets", "to recover the original formulation of weight decay regularization", null],
  ["adam", "adafactor", "improves", "memory efficiency", "Maintaining these per-parameter second-moment estimators requires memory equal to the number of parameters", "maintaining only the per-row and per-column sums of these moving averages", "Combining these methods and dropping momentum, we achieve comparable results to the published Adam regime"],
  ["adam", "lamb", "improves", "scalability", "Training large deep neural networks on massive datasets is computationally very challenging", "we develop a new layerwise adaptive large batch optimization technique called LAMB", null],
  ["adam", "shampoo", "improves", "training complexity", "preconditioning requires storing and manipulating prohibitively large matrices", "each of which operates on a single dimension, contracting over the remaining dimensions", "Although it involves a more complex update rule, Shampoo's runtime per step is comparable to that of simple gradient methods"],
  ["adamw", "lion", "improves", "memory efficiency", "It is more memory-efficient than Adam as it only keeps track of the momentum", "its update has the same magnitude for each parameter calculated through the sign operation", "It also requires a smaller learning rate than Adam due to the larger norm of the update produced by the sign function"],
  ["adamw", "sophia", "improves", "training complexity", "more sophisticated second-order (Hessian-based) optimizers often incur too much per-step overhead", "uses a light-weight estimate of the diagonal Hessian as the pre-conditioner", null],
  ["lion", "sophia", "compares", "training complexity", "more sophisticated second-order (Hessian-based) optimizers often incur too much per-step overhead", "uses a light-weight estimate of the diagonal Hessian as the pre-conditioner", null],
  ["lamb", "lion", "compares", "memory efficiency", "It is more memory-efficient than Adam as it only keeps track of the momentum", "its update has the same magnitude for each parameter calculated through the sign operation", "It also requires a smaller learning rate than Adam due to the larger norm of the update produced by the sign function"],
  ["shampoo", "sophia", "compares", "training complexity", "more sophisticated second-order (Hessian-based) optimizers often incur too much per-step overhead", "uses a light-weight estimate of the diagonal Hessian as the pre-conditioner", null],
  // Normalisation (13).
  ["batchnorm", "layernorm", "adapts", "training stability", "However, the effect of batch normalization is dependent on the mini-batch size and it is not obvious how to apply it to recurrent neural networks", "computing the mean and variance used for normalization from all of the summed inputs to the neurons in a layer on a single training case", null],
  ["batchnorm", "batch-renorm", "improves", "training stability", "However, its effectiveness diminishes when the training minibatches are small, or do not consist of independent samples", "to ensure that the training and inference models generate the same outputs that depend on individual examples rather than the entire minibatch", null],
  ["batchnorm", "groupnorm", "adapts", "robustness", "BN's error increases rapidly when the batch size becomes smaller, caused by inaccurate batch statistics estimation", "GN divides the channels into groups and computes within each group the mean and variance for normalization", null],
  ["batchnorm", "weightnorm", "adapts", "training stability", "Our reparameterization is inspired by batch normalization but does not introduce any dependencies between the examples in a minibatch", "a reparameterization of the weight vectors in a neural network that decouples the length of those weight vectors from their direction", null],
  ["batchnorm", "spectral-norm", "adapts", "training stability", "One of the challenges in the study of generative adversarial networks is the instability of its training", "we propose a novel weight normalization technique called spectral normalization to stabilize the training of the discriminator", null],
  ["batchnorm", "frn", "improves", "training stability", "Batch Normalization (BN) uses mini-batch statistics to normalize the activations during training, introducing dependence between mini-batch elements", "a novel combination of a normalization and an activation function", null],
  ["layernorm", "rmsnorm", "improves", "inference speed", "However, the computational overhead introduced by LayerNorm makes these improvements expensive and significantly slows the underlying network", "RMSNorm regularizes the summed inputs to a neuron in one layer according to root mean square (RMS)", null],
  ["layernorm", "groupnorm", "extends", "robustness", "BN's error increases rapidly when the batch size becomes smaller, caused by inaccurate batch statistics estimation", "GN divides the channels into groups and computes within each group the mean and variance for normalization", null],
  ["groupnorm", "frn", "compares", "training stability", "However, they either do not match the performance of BN for large batches, or still exhibit degradation in performance for smaller batches, or introduce artificial constraints on the model architecture", "Our method operates on each activation channel of each batch element independently, eliminating the dependency on other batch elements", null],
  ["batchnorm", "nfnet", "compares", "simplicity", "Batch normalization is a key component of most image classification models, but it has many undesirable properties stemming from its dependence on the batch size and interactions between examples", "we develop an adaptive gradient clipping technique which overcomes these instabilities", null],
  ["layernorm", "dyt", "replaces", "simplicity", "layer normalization in Transformers often produces tanh-like", "as a drop-in replacement for normalization layers in Transformers", null],
  ["layernorm", "nfnet", "compares", "simplicity", "many undesirable properties stemming from its dependence on the batch size", "we develop an adaptive gradient clipping technique which overcomes these instabilities", null],
  ["batch-renorm", "frn", "compares", "training stability", "they either do not match the performance of BN for large batches, or still exhibit degradation in performance for smaller batches", "Our method operates on each activation channel of each batch element independently, eliminating the dependency on other batch elements", null],
  // Parameter-efficient fine-tuning (18).
  ["full-finetuning", "adapters", "improves", "memory efficiency", "in the presence of many downstream tasks, fine-tuning is parameter inefficient: an entire new model is required for every task", "they add only a few trainable parameters per task", "we attain within 0.4% of the performance of full fine-tuning, adding only 3.6% parameters per task"],
  ["full-finetuning", "prefix-tuning", "improves", "memory efficiency", "it modifies all the language model parameters and therefore necessitates storing a full copy for each task", "which keeps language model parameters frozen, but optimizes a small continuous task-specific vector", null],
  ["full-finetuning", "prompt-tuning", "improves", "memory efficiency", "large models are costly to share and serve, and the ability to reuse one frozen model for multiple downstream tasks can ease this burden", "soft prompts are learned through backpropagation and can be tuned to incorporate signal from any number of labeled examples", null],
  ["full-finetuning", "lora", "improves", "memory efficiency", "As we pre-train larger models, full fine-tuning, which retrains all model parameters, becomes less feasible", "which freezes the pre-trained model weights and injects trainable rank decomposition matrices into each layer", null],
  ["full-finetuning", "bitfit", "improves", "memory efficiency", "competitive with (and sometimes better than) fine-tuning the entire model", "where only the bias-terms of the model (or a subset of them) are being modified", "For larger data, the method is competitive with other sparse fine-tuning methods"],
  ["full-finetuning", "compacter", "improves", "memory efficiency", "wasteful as it requires storing a separate copy of the model for each task", "Compacter inserts task-specific weight matrices into a pretrained model's weights", null],
  ["adapters", "lora", "improves", "inference speed", "unlike adapters, no additional inference latency", "which freezes the pre-trained model weights and injects trainable rank decomposition matrices into each layer", null],
  ["adapters", "compacter", "improves", "memory efficiency", "these approaches either still require a relatively large number of parameters or underperform standard fine-tuning", "Compacter accomplishes this by building on top of ideas from adapters, low-rank optimization, and parameterized hypercomplex multiplication layers", null],
  ["adapters", "prefix-tuning", "compares", "memory efficiency", "it modifies all the language model parameters and therefore necessitates storing a full copy for each task", "which keeps language model parameters frozen, but optimizes a small continuous task-specific vector", null],
  ["prefix-tuning", "prompt-tuning", "adapts", "simplicity", "Our method can be seen as a simplification of the recently proposed", "soft prompts are learned through backpropagation and can be tuned to incorporate signal from any number of labeled examples", null],
  ["prefix-tuning", "p-tuning-v2", "improves", "generalization", "We also find that existing methods of prompt tuning cannot handle hard sequence labeling tasks, indicating a lack of universality", "Our method P-Tuning v2 is an implementation of Deep Prompt Tuning", null],
  ["prefix-tuning", "lora", "compares", "memory efficiency", "As we pre-train larger models, full fine-tuning, which retrains all model parameters, becomes less feasible", "which freezes the pre-trained model weights and injects trainable rank decomposition matrices into each layer", null],
  ["prompt-tuning", "p-tuning-v2", "improves", "generalization", "in the context of NLU, prior work reveals that prompt tuning does not perform well for normal-sized pretrained models", "Our method P-Tuning v2 is an implementation of Deep Prompt Tuning", null],
  ["lora", "qlora", "improves", "memory efficiency", "reduces memory usage enough to finetune a 65B parameter model on a single 48GB GPU", "QLoRA backpropagates gradients through a frozen, 4-bit quantized pretrained language model into Low Rank Adapters", null],
  ["lora", "adalora", "improves", "memory efficiency", "These methods often evenly distribute the budget of incremental updates across all pre-trained weight matrices, and overlook the varying importance of different weight parameters", "we propose AdaLoRA, which adaptively allocates the parameter budget among weight matrices according to their importance score", null],
  ["lora", "dora", "improves", "accuracy", "there still often exists an accuracy gap between these methods and full fine-tuning (FT)", "DoRA decomposes the pre-trained weight into two components, magnitude and direction, for fine-tuning", null],
  ["lora", "pissa", "improves", "training stability", "which may lead to slow convergence", "allowing faster convergence and enhanced performance", null],
  ["lora", "vera", "improves", "memory efficiency", "but still faces acute storage challenges when scaling to even larger models or deploying numerous per-user or per-task adapted models", "It achieves this by using a single pair of low-rank matrices shared across all layers and learning small scaling vectors instead", null],
  // Quantisation (19).
  ["binaryconnect", "qat", "extends", "accuracy", "call for efficient and accurate on-device inference schemes", "We propose a quantization scheme that allows inference to be carried out using integer-only arithmetic", null],
  ["binaryconnect", "xnor-net", "extends", "inference speed", "We compare our method with recent network binarization methods, BinaryConnect and BinaryNets, and outperform these methods by large margins on ImageNet", "In XNOR-Networks, both the filters and the input to convolutional layers are binary", "is only 2.9% less than the full-precision AlexNet"],
  ["xnor-net", "qat", "improves", "accuracy", "call for efficient and accurate on-device inference schemes", "We propose a quantization scheme that allows inference to be carried out using integer-only arithmetic", null],
  ["qat", "llm-int8", "adapts", "memory efficiency", "Large language models have been widely adopted but require significant GPU memory for inference", "which cut the memory needed for inference by half while retaining full precision performance", null],
  ["qat", "gptq", "compares", "memory efficiency", "even inference for large, highly-accurate GPT models may require multiple performant GPUs, which limits the usability of such models", "a new one-shot weight quantization method based on approximate second-order information", null],
  ["qat", "smoothquant", "adapts", "accuracy", "However, existing methods cannot maintain accuracy and hardware efficiency at the same time", "SmoothQuant smooths the activation outliers by offline migrating the quantization difficulty from activations to weights with a mathematically equivalent transformation", null],
  ["qat", "hawq", "improves", "accuracy", "However, uniformly quantizing a model to ultra low precision leads to significant accuracy degradation", "we introduce Hessian AWare Quantization (HAWQ), a novel second-order quantization method to address these problems", null],
  ["hawq", "gptq", "improves", "inference speed", "even inference for large, highly-accurate GPT models may require multiple performant GPUs", "a new one-shot weight quantization method based on approximate second-order information", null],
  ["llm-int8", "gptq", "improves", "memory efficiency", "which limits the usability of such models", "reducing the bitwidth down to 3 or 4 bits per weight, with negligible accuracy degradation relative to the uncompressed baseline", null],
  ["llm-int8", "awq", "improves", "accuracy", "However, the astronomical model size and the limited hardware resource pose significant deployment challenges", "Protecting only 1% salient weights can greatly reduce quantization error", null],
  ["llm-int8", "smoothquant", "improves", "inference speed", "However, existing methods cannot maintain accuracy and hardware efficiency at the same time", "SmoothQuant smooths the activation outliers by offline migrating the quantization difficulty from activations to weights with a mathematically equivalent transformation", null],
  ["gptq", "awq", "improves", "accuracy", "However, the astronomical model size and the limited hardware resource pose significant deployment challenges", "Protecting only 1% salient weights can greatly reduce quantization error", null],
  ["gptq", "quip", "improves", "accuracy", "produce viable results using only two bits per weight", "an adaptive rounding procedure minimizing a quadratic proxy objective", null],
  ["gptq", "squeezellm", "improves", "memory efficiency", "This has forced existing deployment frameworks to use multi-GPU inference pipelines, which are often complex and costly, or to use smaller and less performant models", "enables lossless compression to ultra-low precisions of up to 3-bit", null],
  ["gptq", "aqlm", "improves", "accuracy", "targeting extremely low bit counts, such as 2 to 3 bits per parameter", "generalizes the classic Additive Quantization (AQ) approach for information retrieval", null],
  ["gptq", "spqr", "improves", "accuracy", "However, quantization down to 3-4 bits per parameter usually leads to moderate-to-high accuracy losses, especially for smaller models in the 1-10B parameter range", "identifying and isolating outlier weights, which cause particularly-large quantization errors, and storing them in higher precision", null],
  ["smoothquant", "kivi", "adapts", "memory efficiency", "becomes the new bottleneck in speed and memory usage", "we developed a tuning-free 2bit KV cache quantization algorithm named KIVI", null],
  ["smoothquant", "awq", "compares", "accuracy", "However, the astronomical model size and the limited hardware resource pose significant deployment challenges", "Protecting only 1% salient weights can greatly reduce quantization error", null],
  ["quip", "aqlm", "compares", "accuracy", "targeting extremely low bit counts, such as 2 to 3 bits per parameter", "generalizes the classic Additive Quantization (AQ) approach for information retrieval", null],
  // Cross-lineage (1): KV-cache efficiency is the shared bottleneck.
  ["gqa", "kivi", "adapts", "memory efficiency", "becomes the new bottleneck in speed and memory usage", "we developed a tuning-free 2bit KV cache quantization algorithm named KIVI", null],
];

// ---------------------------------------------------------------------------
// arXiv Atom parsing (no dependencies).
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function clean(text) {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function parseAtom(xml) {
  const entries = [];
  for (const block of xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? []) {
    const idMatch = block.match(/<id>https?:\/\/arxiv\.org\/abs\/([0-9]+\.[0-9]+)(v\d+)?<\/id>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
    if (!idMatch || !titleMatch || !summaryMatch || !publishedMatch) continue;
    const authors = [...block.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) =>
      clean(m[1]),
    );
    entries.push({
      arxivId: idMatch[1],
      title: clean(titleMatch[1]),
      abstract: clean(summaryMatch[1]),
      published: publishedMatch[1].trim(),
      authors,
    });
  }
  return entries;
}

async function fetchMetadata(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    if (i > 0) await sleep(PACE_MS);
    const res = await fetch(`${API}${batch.join(",")}`, {
      headers: { "User-Agent": "scout-lineage-seed/1.0 (build-time metadata fetch)" },
    });
    if (!res.ok) throw new Error(`arXiv API HTTP ${res.status} for batch ${batch.join(",")}`);
    const xml = await res.text();
    for (const entry of parseAtom(xml)) out.set(entry.arxivId, entry);
    console.log(`fetched batch ${i / BATCH_SIZE + 1}: ${batch.length} ids`);
  }
  for (const id of ids) {
    if (!out.has(id)) throw new Error(`arXiv API returned no record for ${id}; refusing to invent one`);
  }
  return out;
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function main() {
  return (async () => {
    // Fail fast on curated-shape violations before any network call.
    const byId = new Map(METHODS.map((m) => [m.id, m]));
    const pairs = new Set();
    for (const [from, to] of EDGES) {
      if (!byId.has(from) || !byId.has(to)) throw new Error(`edge references unknown method ${from}→${to}`);
      if (byId.get(from).year > byId.get(to).year) {
        throw new Error(`year-order violation in curation: ${from} (${byId.get(from).year}) → ${to} (${byId.get(to).year})`);
      }
      if (pairs.has(`${from}→${to}`)) throw new Error(`duplicate edge ${from}→${to}`);
      if (pairs.has(`${to}→${from}`)) throw new Error(`reverse pair ${from}→${to}`);
      pairs.add(`${from}→${to}`);
    }

    const uniqueIds = [...new Set(METHODS.map((m) => m.arxivId))];
    const meta = await fetchMetadata(uniqueIds);
    const retrievedAt = new Date().toISOString();

    const paperByArxiv = new Map();
    for (const m of METHODS) {
      if (paperByArxiv.has(m.arxivId)) continue;
      const entry = meta.get(m.arxivId);
      paperByArxiv.set(m.arxivId, {
        arxivId: m.arxivId,
        title: entry.title,
        authors: entry.authors,
        venue: m.venue,
        tier: m.tier,
        url: `https://arxiv.org/abs/${m.arxivId}`,
        abstract: entry.abstract,
        provenance: {
          publisher: "arXiv.org e-Print archive",
          retrievedAt,
          releasedAt: new Date(entry.published).toISOString(),
        },
      });
    }

    const nodes = [];
    for (const m of METHODS) {
      const node = {
        id: m.id,
        kind: "method",
        name: m.name,
        aliases: m.aliases,
        year: m.year,
        paper: paperByArxiv.get(m.arxivId),
      };
      if (m.parent) node.parent = m.parent;
      nodes.push(node);
    }
    for (const m of METHODS) {
      const paperNodeId = `arxiv:${m.arxivId}`;
      if (nodes.some((n) => n.id === paperNodeId)) continue;
      const paper = paperByArxiv.get(m.arxivId);
      nodes.push({
        id: paperNodeId,
        kind: "paper",
        name: paper.title,
        aliases: [],
        year: new Date(paper.provenance.releasedAt).getUTCFullYear(),
        paper,
      });
    }

    const STRONG = new Set(["extends", "improves", "replaces", "adapts"]);
    const edges = [];
    const dropped = [];
    for (const [from, to, type, axis, bottleneck, mechanism, tradeoff] of EDGES) {
      const toMethod = byId.get(to);
      const abstract = paperByArxiv.get(toMethod.arxivId).abstract;
      const sourceId = `arxiv:${toMethod.arxivId}`;
      const quote = (text) => ({ text, sourceId, locator: "abstract" });
      const checks = [
        ["bottleneck", bottleneck],
        ["mechanism", mechanism],
        ["tradeoff", tradeoff],
      ];
      let bad = null;
      for (const [key, text] of checks) {
        if (text === null) continue;
        if (!normalize(abstract).includes(normalize(text))) {
          bad = `${key} quote is not a verbatim substring of ${sourceId} abstract`;
          break;
        }
      }
      if (bad) {
        dropped.push({ edgeId: `${from}--${to}`, code: "verbatim", detail: bad });
        continue;
      }
      const isStrong = STRONG.has(type);
      edges.push({
        id: `${from}--${to}`,
        from,
        to,
        type,
        strength: isStrong ? "strong" : "weak",
        evidence: {
          bottleneck: quote(bottleneck),
          mechanism: quote(mechanism),
          tradeoff: tradeoff === null ? null : quote(tradeoff),
          confidence: tradeoff === null ? 0.8 : 1.0,
          confidenceBasis:
            tradeoff === null
              ? "Tradeoff quote is null; confidence 0.8."
              : "All three quotes are verbatim substrings of the to-paper abstract; confidence 1.0." +
                (isStrong ? "" : " Edge type is compares (weak): confidence covers quote validity, not a causal claim."),
        },
        axis,
      });
    }

    const graph = {
      version: "1.0",
      builtAt: retrievedAt,
      source: { kind: "curated", curator: "scout", reviewedBy: null },
      nodes,
      edges,
    };
    const json = `${JSON.stringify(graph, null, 2)}\n`;
    writeFileSync(OUT_PATH, json, "utf8");
    const methods = nodes.filter((n) => n.kind === "method").length;
    const papers = nodes.filter((n) => n.kind === "paper").length;
    const strong = edges.filter((e) => e.strength === "strong").length;
    console.log(`wrote ${OUT_PATH}`);
    console.log(
      `methods=${methods} papers=${papers} edges=${edges.length} ` +
        `strong=${strong} (${((100 * strong) / edges.length).toFixed(1)}%) ` +
        `dropped=${dropped.length} size=${Buffer.byteLength(json)} bytes`,
    );
    for (const d of dropped) console.log(`DROPPED ${d.edgeId}: ${d.detail}`);
    if (Buffer.byteLength(json) >= 400 * 1024) {
      console.error("WARNING: graph.json is >= 400 KB (SPEC C3.5 budget)");
    }
  })();
}

main().catch((err) => {
  console.error(`lineage-seed-fetch failed: ${err.message}`);
  process.exit(1);
});
