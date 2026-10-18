// Chip data ported 1:1 from jcamd/chips (single-file vanilla JS + THREE).
// Default variants only: EPYC 9654 "Genoa", H100 SXM5, BlueField-3.
// Every number below comes from that source file — nothing invented here.

export type ChipId = 'cpu' | 'gpu' | 'dpu';
export type DepthLevel = 'eli5' | 'fifteen' | 'pro' | 'expert';

export const DEPTH_LABELS: Record<DepthLevel, string> = {
  eli5: 'ELI5',
  fifteen: 'Ages 15+',
  pro: 'Pro',
  expert: 'Expert',
};

export interface PartEntry {
  chip: ChipId;
  cls: string[];
  name: string;
  spec: string[];
  eli5: string;
  fifteen: string;
  pro: string;
  expert: string;
}

export const CLS_NAME: Record<string, string> = {
  "compute": "Compute cores",
  "cache": "Cache hierarchy",
  "memory": "Memory system",
  "interconnect": "Interconnect",
  "network": "Network I/O",
  "accel": "Accelerators",
  "package": "Package"
};

export const CHIP_OF: Record<ChipId, string> = {
  "cpu": "CPU",
  "gpu": "GPU",
  "dpu": "DPU"
};

export const CHIP_MODEL: Record<ChipId, string> = {
  "cpu": "AMD EPYC 9654 “Genoa”",
  "gpu": "NVIDIA H100 SXM5 “GH100”",
  "dpu": "NVIDIA BlueField-3"
};

export const PARTS: Record<string, PartEntry> = {
  "cpu-ihs": {
    "chip": "cpu",
    "cls": [
      "package"
    ],
    "name": "Nickel heat spreader (IHS)",
    "spec": [
      "Ni-plated copper",
      "Indium-solder TIM1",
      "SP5 cold-plate datum"
    ],
    "eli5": "The shiny metal hat on the CPU. It spreads heat flat so the big cooler on top can carry it away, and it protects 13 fragile silicon dies underneath.",
    "fifteen": "The integrated heat spreader: nickel-plated copper, soldered to all 13 dies. It evens out hot spots from the chiplets and takes the clamping force of the socket.",
    "pro": "Ni-plated Cu lid, indium-solder TIM1 to CCDs/sIOD. Spreads up to 400 W across the SP5 cold plate; also the mechanical datum the retention mechanism torques against.",
    "expert": "IHS stack: die → In solder (~80 W/m·K) → Ni-plated Cu → TIM2 → cold plate. Solder avoids pump-out over thermal cycling; bond-line uniformity across 13 dies is the packaging challenge."
  },
  "cpu-tim": {
    "chip": "cpu",
    "cls": [
      "package"
    ],
    "name": "Thermal interface (TIM1)",
    "spec": [
      "Indium solder",
      "~20–50 µm bond line",
      "Fills micro-gaps"
    ],
    "eli5": "A super-thin layer of melted metal between the brains and the hat. Air blocks heat, so this fills every tiny gap.",
    "fifteen": "Thermal interface material: server chips use indium solder instead of paste — lower thermal resistance, survives years of heat cycles.",
    "pro": "TIM1: indium solder, ~20–50 µm. Its thermal resistance is a first-order limiter of sustained boost clocks across the package.",
    "expert": "In-solder TIM1 (~80 W/m·K); void fraction and CTE fatigue dominate long-term Rth. Thickness control across 13 dies at SP5 scale is non-trivial."
  },
  "cpu-ccd": {
    "chip": "cpu",
    "cls": [
      "compute",
      "cache",
      "accel"
    ],
    "name": "12× CCD chiplets — compute",
    "spec": [
      "8× Zen 4 cores each",
      "1 MB L2 / core",
      "32 MB L3 / CCD · 384 MB total"
    ],
    "eli5": "Twelve tiny brains doing the actual thinking — 8 workers on each, 96 total. They are small on purpose: small squares are cheaper to make without mistakes.",
    "fifteen": "Twelve Core Complex Dies, 8 Zen 4 cores each, on TSMC 5 nm. Small dies = high yield: a defect ruins one small chiplet, not a giant die. Each CCD carries its own 32 MB of L3.",
    "pro": "12× N5 CCDs (2× 4-core CCX, 1 MB L2/core, 32 MB L3/CCD) around the sIOD, linked by Infinity Fabric. Chiplet disaggregation lets AMD bin/mix CCDs and reuse the I/O die across SKUs.",
    "expert": "Zen 4 “Persephone” CCD, ~72 mm² on N5: 8 cores, AVX-512 w/ 256-bit datapath, 32 MB L3. IFOP links to sIOD. 12 CCDs = 96C/192T; Genoa-X stacks 3D V-Cache TSVs on this same CCD for 1152 MB L3."
  },
  "cpu-iod": {
    "chip": "cpu",
    "cls": [
      "memory",
      "interconnect"
    ],
    "name": "Server I/O die (sIOD)",
    "spec": [
      "12× DDR5 channels",
      "128× PCIe Gen5",
      "Infinity Fabric hub"
    ],
    "eli5": "The big square in the middle — the post office. It carries messages between the 12 thinking-chiplets, the memory sticks, and everything plugged into the computer.",
    "fifteen": "No compute cores — just the 12 DDR5 memory controllers, PCIe lanes, and the Infinity Fabric switch tying all 12 CCDs together.",
    "pro": "6 nm sIOD: 12 DDR5 controllers (460.8 GB/s), 128× PCIe Gen5 + CXL SERDES, 3rd-gen Infinity Fabric hub. All CCD traffic and all off-socket I/O funnels through it — the latency tax of the chiplet design.",
    "expert": "sIOD on N6 (mature node for analog/PHY): configurable SERDES, IFOP to 12 CCDs, GMI/xGMI inter-socket, SEV-SNP secure processor. CCD→CCD traffic traverses IF through the sIOD — NUMA effects are real and measurable."
  },
  "cpu-substrate": {
    "chip": "cpu",
    "cls": [
      "package"
    ],
    "name": "Organic package substrate",
    "spec": [
      "ABF build-up PCB",
      "Escapes 13 dies to LGA",
      "Power planes + caps"
    ],
    "eli5": "The plate everything sits on — a tiny circuit board with thousands of hidden wires connecting the brains to the golden feet below.",
    "fifteen": "A miniature multi-layer PCB fanning thousands of dense die connections out to the package pads, with thick copper planes feeding hundreds of amps.",
    "pro": "ABF organic substrate: escapes ~10k C4 bumps from 13 dies to LGA-6096 lands, distributes 400 W-class current with controlled IR drop, hosts land-side decoupling.",
    "expert": "HDI build-up; microvia stack; PDN designed for high di/dt; CTE matching vs the 13-die MCM controls warpage across the 60×75 mm SP5 footprint."
  },
  "cpu-pads": {
    "chip": "cpu",
    "cls": [
      "package"
    ],
    "name": "LGA-6096 lands",
    "spec": [
      "6,096 contacts",
      "Socketed · field-replaceable",
      "~60% power/ground"
    ],
    "eli5": "The 6,096 golden feet on the bottom. The CPU just sits on springy pins in its socket — you can swap it out, no legs to bend.",
    "fifteen": "Land grid array: flat gold pads press against spring pins in the SP5 socket. Most pads carry power and ground — feeding the chip takes more pins than signals do.",
    "pro": "LGA-6096: socketed interface. Pin count is driven by current delivery (400 W) and 12 memory channels, not logic signals.",
    "expert": "Contact resistance and insertion force scale with current; power/ground ratio minimizes PDN loop inductance. Socketed = field-replaceable, at a cost in contact reliability vs soldered BGA."
  },
  "gpu-lid": {
    "chip": "gpu",
    "cls": [
      "package"
    ],
    "name": "Vapor-chamber lid",
    "spec": [
      "Copper vapor chamber",
      "Sheds 700 W",
      "Cold-plate interface"
    ],
    "eli5": "The big copper hat on the GPU. It makes as much heat as a hair dryer, so special liquid inside the hat spreads the heat super evenly.",
    "fifteen": "A sealed copper plate with liquid that evaporates at hot spots and condenses at cool edges — spreading 700 W evenly to the liquid cold plate bolted on top.",
    "pro": "Two-phase heat spreading for ~700 W at low thermal resistance; the lid is also the mechanical datum for the cold plate (flatness spec’d in microns).",
    "expert": "Sintered-wick vapor chamber, ~0.05–0.1 °C/W spreading resistance. Required because 700 W over 814 mm² overwhelms solid copper; TIM1 here is typically polymer, not solder."
  },
  "gpu-gpc": {
    "chip": "gpu",
    "cls": [
      "compute",
      "accel"
    ],
    "name": "GH100 die — SM clusters",
    "spec": [
      "144 SMs on die · 132 enabled",
      "128 CUDA + 4 Tensor / SM",
      "16,896 CUDA cores active"
    ],
    "eli5": "The giant brain cut into 144 neighborhoods. Each neighborhood has 128 tiny workers doing math side by side, plus 4 super-fast matrix helpers.",
    "fifteen": "One 814 mm² monolithic die: 8 GPCs × 9 TPCs × 2 SMs. Each SM packs 128 CUDA cores and 4 fourth-gen Tensor Cores — the matrix engines AI training lives on.",
    "pro": "GH100 on TSMC 4N: 80B transistors, 128 FP32 + 64 FP64 + 4 Tensor Cores per SM, Transformer Engine (FP8), DPX instructions, MIG. Monolithic because SM-to-SM bandwidth can’t tolerate chiplet hops.",
    "expert": "Reticle-limit monolithic (~814 mm²) — chiplet partitioning rejected because the all-to-all SM/L2 crossbar needs single-die latency. 4th-gen Tensor Cores do 4:2 structured sparsity; FP8 Transformer Engine with per-tensor scaling."
  },
  "gpu-l2": {
    "chip": "gpu",
    "cls": [
      "cache"
    ],
    "name": "50 MB L2 cache slices",
    "spec": [
      "50 MB enabled (60 MB on die)",
      "Shared by all 132 SMs",
      "Partitioned slices"
    ],
    "eli5": "The brain’s shared scratchpad. All 144 neighborhoods read and write here, so nobody has to walk all the way out to the memory towers.",
    "fifteen": "50 MB of L2 sliced around the die edge, shared by every SM — the rendezvous point where 132 multiprocessors exchange data without leaving the chip.",
    "pro": "Partitioned 50 MB L2 (60 MB physical) between SM fabric and HBM controllers; absorbs streaming reuse and coalesces HBM traffic. Sizing is a bandwidth filter, not a latency cache.",
    "expert": "L2 slices sit on the memory-controller crossbar; hit bandwidth is an order above HBM. L2 residency determines whether kernels are HBM-bound — the key tuning knob for LLM inference."
  },
  "gpu-hbm": {
    "chip": "gpu",
    "cls": [
      "memory"
    ],
    "name": "HBM3 stacks",
    "spec": [
      "5 active of 6 on package",
      "80 GB · ~3.35 TB/s",
      "1024-bit per stack"
    ],
    "eli5": "Six little towers of memory standing right next to the brain — like keeping crayons in your pockets instead of across the room. Super close = super fast.",
    "fifteen": "DRAM dies stacked vertically with through-silicon vias, millimeters from the compute die. 80 GB at ~3.35 TB/s — ~7× the bandwidth of DDR5, at a fraction of the capacity.",
    "pro": "HBM3, 1024-bit per stack, TSV-stacked DRAM with ECC. Five of six stacks enabled on H100 SXM5 (yield binning). Stacked memory trades capacity and cost for bandwidth — the axis AI training demands.",
    "expert": "~6.4 Gbps/pin class, on-die ECC + sideband; thermal coupling to GH100 through the interposer constrains stacks. Capacity ceiling is the stack height — H200 moved to taller HBM3e for 141 GB."
  },
  "gpu-interposer": {
    "chip": "gpu",
    "cls": [
      "interconnect",
      "package"
    ],
    "name": "Silicon interposer (CoWoS)",
    "spec": [
      "TSMC CoWoS 2.5D",
      "~10k micro-bumps",
      "Enables the 5120-bit bus"
    ],
    "eli5": "A paper-thin silicon plate under the brain, covered in invisible bridges connecting it to its six memory neighbors.",
    "fifteen": "The compute die and HBM stacks sit on a silicon interposer whose microscopic wiring carries ~3.35 TB/s — no circuit board could route that.",
    "pro": "CoWoS-S 2.5D: passive Si interposer, ~45 µm micro-bump pitch, RDL at ~2 µm line/space. The physical enabler of the 5120-bit HBM3 interface.",
    "expert": "Interposer yield dominates module cost: one bad HBM stack or micro-bump scraps the whole CoWoS assembly — hence known-good-die test. Interposer is passive; all logic is in GH100."
  },
  "gpu-nvlink": {
    "chip": "gpu",
    "cls": [
      "interconnect"
    ],
    "name": "NVLink edge — 4th gen",
    "spec": [
      "900 GB/s GPU-to-GPU",
      "~7× PCIe Gen5",
      "NVSwitch to 256 GPUs"
    ],
    "eli5": "Golden teeth on the board edge — super-fast bridges so neighboring GPUs share work directly, without asking the CPU for help.",
    "fifteen": "Direct GPU-to-GPU interconnect at 900 GB/s. Eight H100s gossip at near-memory speed to split giant AI models between them.",
    "pro": "NVLink 4.0: 18 links, cache-coherent-ish GPU fabric. Lets 8× H100s act as one memory pool for model-parallel training; host PCIe is demoted to a side channel.",
    "expert": "NVSwitch fabrics scale to 256 GPUs; enables tensor/pipeline parallelism with all-reduce at fabric speed — the physical reason DGX/HGX topologies exist."
  },
  "gpu-pcb": {
    "chip": "gpu",
    "cls": [
      "package"
    ],
    "name": "SXM5 module board",
    "spec": [
      "Mezzanine, not a PCIe card",
      "30+ VRM phases",
      "700 W delivery"
    ],
    "eli5": "The dark board the GPU lives on. It bolts flat onto the motherboard instead of plugging into a slot, so it can drink 700 watts.",
    "fifteen": "A mezzanine board with 30+ power phases and a board-to-board connector — the only way to feed 700 W plus NVLink. No PCIe slot could do this.",
    "pro": "Mezzanine connector carries power blades + NVLink + PCIe Gen5. Form factor exists because no slot delivers 700 W or 900 GB/s fabric bandwidth.",
    "expert": "PDN must handle >500 A with tight transient response for Tensor Core bursts; power blades replace edge-connector current limits."
  },
  "gpu-pads": {
    "chip": "gpu",
    "cls": [
      "package"
    ],
    "name": "SXM5 connector pads",
    "spec": [
      "Board-to-board mezzanine",
      "Power blades + signals",
      "Not user-serviceable"
    ],
    "eli5": "The golden strips underneath that press into the motherboard — power and data flow through here.",
    "fifteen": "High-density mezzanine pads: fat power blades plus thousands of signal contacts for NVLink and PCIe. Installed by technicians, never swapped by users.",
    "pro": "Mezzanine interface: separates the GPU module (field-replaceable unit) from the HGX baseboard. Power blades carry the 700 W the signal pins never could.",
    "expert": "Contact system rated for high-mating-cycle service in DGX/HGX chassis; the module — not the die — is the service boundary."
  },
  "dpu-hs": {
    "chip": "dpu",
    "cls": [
      "package"
    ],
    "name": "Finned heatsink",
    "spec": [
      "Stamped aluminum",
      "Airflow-cooled",
      "No liquid needed"
    ],
    "eli5": "The metal comb on top that lets heat escape into the air. The DPU sips power next to its big brothers, so a simple comb is plenty.",
    "fifteen": "Stamped fins cooled by server airflow. The DPU’s power budget is a fraction of a CPU or GPU — no vapor chamber, no liquid.",
    "pro": "Finned Al heatsink on chassis airflow. Power envelope permits passive card-level cooling — a deliberate TCO choice: one DPU per server must be cheap to cool.",
    "expert": "No TIM2/cold-plate stack; junction temps held in spec under worst-case chassis airflow. Low cooling cost is part of the DPU value prop."
  },
  "dpu-cores": {
    "chip": "dpu",
    "cls": [
      "compute"
    ],
    "name": "16× Arm Cortex-A78",
    "spec": [
      "Armv8.2 · 64-bit",
      "Coherent mesh",
      "Control-plane CPUs"
    ],
    "eli5": "Sixteen small, efficient brains running the DPU’s own operating system — they boss the helper gadgets around and talk to the server.",
    "fifteen": "A cluster of 16 Arm A78 cores on a low-latency coherent mesh, running the DPU’s own Linux. They run control software; the heavy packet work is offloaded to fixed gadgets.",
    "pro": "16× Armv8.2 A78 on coherent mesh, optimized for control-plane. Runs DOCA Linux independently of the host — the DPU boots and provisions before the server does.",
    "expert": "A78 “Hercules” cores; mesh keeps core-to-accelerator latency low. Control/data-plane split: A78s handle exceptions and policy, DPA + fixed logic handle the fast path."
  },
  "dpu-cache": {
    "chip": "dpu",
    "cls": [
      "cache"
    ],
    "name": "Mesh L2/L3 cache",
    "spec": [
      "Shared on coherent mesh",
      "Packet descriptors",
      "Modest vs CPU"
    ],
    "eli5": "Small scratchpads near the Arm brains for their notes. Packets zoom past too fast to bother caching — they stream straight through.",
    "fifteen": "Cache on the coherent mesh for the Arm cores’ working data. Deliberately modest: network packets stream through accelerators, they’re not cached like CPU data.",
    "pro": "Mesh-shared cache hierarchy sized for control-plane working sets, not data-plane. Packet buffers live in DRAM/SRAM FIFOs — caching them would be pure overhead.",
    "expert": "Cache is a latency play for the A78s only; the data path is deliberately cache-bypassing (streaming DMA) to avoid polluting it with 400 Gb/s of transient packets."
  },
  "dpu-dpa": {
    "chip": "dpu",
    "cls": [
      "compute",
      "accel"
    ],
    "name": "DPA — data-path accelerator",
    "spec": [
      "16 hyperthreaded cores",
      "Packet/I/O processing",
      "Programmable"
    ],
    "eli5": "Sixteen tiny helpers that only do mailroom jobs — sorting packets, stamping them, sending them on — over and over, super fast.",
    "fifteen": "A programmable packet processor: 16 hyperthreaded cores built for I/O-heavy, low-compute chores like device emulation and congestion control.",
    "pro": "DPA: 16-way multithreaded cores for I/O-bound data-path code (virtio emulation, custom protocols). Programmable, unlike the fixed-function blocks.",
    "expert": "VLIW-ish multithreaded cores hide memory latency by thread count — classic network-processor design. DOCA exposes them for user data-path programs."
  },
  "dpu-net": {
    "chip": "dpu",
    "cls": [
      "network"
    ],
    "name": "ConnectX-7 network block",
    "spec": [
      "400 GbE / NDR",
      "RDMA + RoCE",
      "2× QSFP112 ports"
    ],
    "eli5": "The super-fast mailroom — the DPU’s front door to the internet’s highways, handling 400 billion bits every second.",
    "fifteen": "A ConnectX-7-class SmartNIC pipeline on the die: 400 Gb/s Ethernet/InfiniBand with RDMA, so servers exchange data without bothering their CPUs.",
    "pro": "Integrated NIC pipeline: 400G via QSFP112, RDMA/RoCE, overlay offloads (VXLAN/NVGRE encap-decap in hardware). Line-rate with the Arm cores uninvolved.",
    "expert": "PAM4 112G SerDes; hardware congestion control (DCQCN); the NIC pipeline is the DPU’s raison d’être — everything else serves it."
  },
  "dpu-crypto": {
    "chip": "dpu",
    "cls": [
      "accel"
    ],
    "name": "Inline crypto accelerators",
    "spec": [
      "IPsec / TLS inline",
      "4× vs prior gen",
      "Zero-copy encrypt"
    ],
    "eli5": "A lock-and-key shop: it scrambles and unscrambles secret messages at full speed, so the little Arm brains never have to.",
    "fifteen": "Fixed-function encryption engines that apply IPsec/TLS to packets as they fly through — 4× the crypto throughput of the previous generation.",
    "pro": "Inline (bump-in-the-wire) crypto: packets are encrypted in the NIC pipeline at line rate, no CPU cycles, no extra memory copies.",
    "expert": "Inline vs lookaside: data never leaves the pipeline — the latency and throughput win over CPU AES-NI is an order of magnitude at 400G."
  },
  "dpu-regex": {
    "chip": "dpu",
    "cls": [
      "accel"
    ],
    "name": "RegEx engine",
    "spec": [
      "Pattern matching in HW",
      "DPI / IDS offload",
      "Line-rate scan"
    ],
    "eli5": "A super-fast word finder: it scans every passing message for sneaky patterns, like a spell-checker that never sleeps.",
    "fifteen": "A hardware pattern-matcher for deep packet inspection — firewalls and intrusion detection scan traffic at full speed without software.",
    "pro": "Fixed-function regular-expression engine for DPI/IDS: offloads string/pattern matching that would otherwise burn whole CPU cores.",
    "expert": "NFA/DFA in hardware; Morpheus telemetry and IDS workloads run here — the “AI cybersecurity” story is this block plus the A78s."
  },
  "dpu-nvme": {
    "chip": "dpu",
    "cls": [
      "accel"
    ],
    "name": "NVMe-oF offload",
    "spec": [
      "NVMe over Fabrics",
      "Target + initiator",
      "Storage without CPU"
    ],
    "eli5": "The warehouse crew: it fetches boxes (data) from far-away storage shelves without bothering the main computer.",
    "fifteen": "Hardware that speaks NVMe-over-Fabrics — the DPU serves remote storage to the host as if it were a local SSD, CPU uninvolved.",
    "pro": "NVMe-oF target/initiator offload: remote NVMe namespaces presented locally with RDMA transport, zero host-CPU involvement per I/O.",
    "expert": "Storage disaggregation primitive: with DPA + NVMe-oF, the DPU is a complete storage controller — the host sees a disk, the DPU does everything else."
  },
  "dpu-pcie": {
    "chip": "dpu",
    "cls": [
      "interconnect"
    ],
    "name": "PCIe Gen5 switch",
    "spec": [
      "Up to 32 lanes Gen5",
      "Endpoint or root complex",
      "Owns devices on bus"
    ],
    "eli5": "The traffic cop for the card’s plug: it can even boss other gadgets around on the computer’s highway, all by itself.",
    "fifteen": "An embedded PCIe switch that can act as endpoint — or as root complex, meaning the DPU can own other devices (like a GPU) without the host.",
    "pro": "PCIe Gen5 switch with endpoint/root-complex personalities. Root-complex mode lets the DPU enumerate and drive devices over a bridge — host-bypass I/O.",
    "expert": "This is the architectural power move: the DPU as PCIe root complex turns the server inside out — infrastructure owns the bus, the host is just a tenant."
  },
  "dpu-dram": {
    "chip": "dpu",
    "cls": [
      "memory"
    ],
    "name": "DDR5 memory controller",
    "spec": [
      "1 controller on die",
      "16–32 GB on-card DDR5",
      "5200–5600 MT/s"
    ],
    "eli5": "A modest bookshelf for the DPU’s own notes — nowhere near as big as the computer’s memory, because packets don’t sit around.",
    "fifteen": "One DDR5 controller feeding 16–32 GB of soldered on-card memory — plenty for an OS and control software, tiny next to a server’s terabytes.",
    "pro": "Single DRAM controller, 16/32 GB DDR5-5200/5600 soldered. Sized for control-plane + buffering; the data plane streams through, it doesn’t live here.",
    "expert": "Memory bandwidth ~5× BlueField-2 (est.); still an order below server DDR5 subsystems — by design, since bulk data bypasses DRAM via accelerators."
  },
  "dpu-qsfp": {
    "chip": "dpu",
    "cls": [
      "network"
    ],
    "name": "QSFP112 cages",
    "spec": [
      "2× 400G ports",
      "Hot-pluggable optics",
      "Front of card"
    ],
    "eli5": "The two chunky sockets where the fat network cables plug in — the DPU’s front doors.",
    "fifteen": "Two QSFP112 cages for 400 Gb/s optics or DACs — the physical ports facing the data-center network.",
    "pro": "2× QSFP112, each 400G (4× 112G PAM4). Port configurability: 1×400G, 2×200G, or 4×100G-class breakouts.",
    "expert": "Signal integrity at 112G PAM4 demands retimers and careful card routing; cages are the serviceable optical boundary."
  },
  "dpu-card": {
    "chip": "dpu",
    "cls": [
      "package"
    ],
    "name": "DPU card board",
    "spec": [
      "PCIe card form factor",
      "Own power + clock",
      "Boots before host"
    ],
    "eli5": "The DPU’s own little circuit board. It plugs into the server like any card, but it carries its own computer.",
    "fifteen": "PCIe card with its own power regulation, clocks, and memory — a complete computer on a card that boots independently of the host server.",
    "pro": "FHHL/HHHL card: independent power/clock domains, on-card DDR5, eMMC + SSD. Boots and runs DOCA Linux before the host — out-of-band provisionable.",
    "expert": "Independent BMC-less boot; DOCA runtime provisions thousands of DPUs out-of-band. The card — not the chip — is the field-replaceable unit."
  },
  "dpu-bga": {
    "chip": "dpu",
    "cls": [
      "package"
    ],
    "name": "BGA solder balls",
    "spec": [
      "Soldered, not socketed",
      "Permanent mount",
      "~1k+ balls (est.)"
    ],
    "eli5": "Hundreds of tiny metal balls melted under the chip, gluing it to its board forever. This chip never needs swapping.",
    "fifteen": "Ball grid array: the SoC is soldered to its card. Permanent and cheap — fine for a chip that ships inside every server.",
    "pro": "Soldered BGA, ~1k+ balls (est.). Lower cost and better shock reliability than LGA; the tradeoff is no field replacement — the card is the FRU.",
    "expert": "Ball pitch ~0.8–1.0 mm class (est.); CTE mismatch managed by alloy/pad design. Rework is possible but economically the card is replaced as a unit."
  }
};

export interface FlowStage {
  name: string;
  parts: string[];
  cap: Record<DepthLevel, string>;
}

export interface ChipFlow {
  color: number;
  path: number[][];
  stages: FlowStage[];
}

export const FLOW: Record<ChipId, ChipFlow> = {
  "cpu": {
    "color": 14715468,
    "path": [
      [
        -5.2,
        0.55,
        1,
        0
      ],
      [
        -2.7,
        0.55,
        1,
        0
      ],
      [
        -1.2,
        0.7,
        1.6,
        0
      ],
      [
        0,
        0.95,
        2.3,
        0
      ],
      [
        -0.9,
        0.95,
        2.3,
        0.3
      ],
      [
        -1.78,
        0.95,
        2.3,
        0.58
      ],
      [
        -1.78,
        1.2,
        2.3,
        0.58
      ],
      [
        -1.78,
        1.38,
        2.3,
        0.58
      ],
      [
        -1.78,
        1.2,
        2.3,
        0.58
      ],
      [
        -1.78,
        0.95,
        2.3,
        0.58
      ],
      [
        -0.9,
        0.95,
        2.3,
        0.3
      ],
      [
        0,
        0.95,
        2.3,
        0
      ],
      [
        1.5,
        0.7,
        1.6,
        0
      ],
      [
        2.7,
        0.55,
        1,
        0
      ],
      [
        5.2,
        0.55,
        1,
        0
      ]
    ],
    "stages": [
      {
        "name": "DDR5 → sIOD",
        "parts": [
          "cpu-iod"
        ],
        "cap": {
          "eli5": "Data arrives from the memory sticks into the post office in the middle of the chip.",
          "fifteen": "DDR5 data lands at the sIOD’s 12 memory controllers — the front door for every byte the cores touch.",
          "pro": "460.8 GB/s across 12 DDR5-4800 channels lands in the sIOD; all off-chip data enters the CPU here.",
          "expert": "sIOD N6 PHYs, 12-ch DDR5-4800; lines queue in the memory controller before IF dispatch — ~100 ns DRAM latency is the floor everything hides."
        }
      },
      {
        "name": "sIOD → L3",
        "parts": [
          "cpu-iod",
          "cpu-ccd"
        ],
        "cap": {
          "eli5": "The post office trucks the data out to a neighborhood’s big shared whiteboard — the L3 cache.",
          "fifteen": "Infinity Fabric forwards the line to the target CCD’s 32 MB L3 — one hop through the sIOD.",
          "pro": "IFOP links carry the line sIOD → CCD into 32 MB L3. CCD-to-CCD traffic pays the sIOD round-trip: NUMA by construction.",
          "expert": "sIOD-star IF topology; L3 fill in the ~46-cycle class. Cross-CCD coherence traverses the sIOD — thread and memory placement measurably moves results."
        }
      },
      {
        "name": "L3 → L2 → Zen 4 core",
        "parts": [
          "cpu-ccd"
        ],
        "cap": {
          "eli5": "A worker copies what it needs from the whiteboard to its own notebook (L2), then does the math.",
          "fifteen": "The core pulls the line into its private 1 MB L2 and executes out-of-order — deep caches hide the DRAM wait.",
          "pro": "Zen 4 fetches into 1 MB L2 (~14 cycles), executes wide OoO with AVX-512. The hierarchy exists because branchy code can’t be prefetched.",
          "expert": "32+32 KB L1 → 1 MB L2 → 32 MB L3; miss penalties cascade. IPC rides on the hierarchy absorbing irregular reuse — Genoa-X triples L3 via TSV for exactly this."
        }
      },
      {
        "name": "Writeback → DDR5",
        "parts": [
          "cpu-ccd",
          "cpu-iod"
        ],
        "cap": {
          "eli5": "Finished work gets copied back up to the whiteboard, then mailed back to the memory sticks.",
          "fifteen": "Dirty lines evict L2 → L3 → sIOD → DDR5. Writeback keeps the hierarchy coherent without stalling the core.",
          "pro": "Writeback through the MOESI-coherent hierarchy; the sIOD memory controllers commit to DDR5 — latency-tolerant, bandwidth-cheap.",
          "expert": "Victim writebacks cascade upward; sIOD ordering + ECC commit closes the loop. The nuance: this whole dance exists to hide ~100 ns DRAM latency from unpredictable code — latency is the enemy."
        }
      }
    ]
  },
  "gpu": {
    "color": 5812390,
    "path": [
      [
        -4.4,
        1.05,
        2.5,
        0
      ],
      [
        -2.62,
        1.05,
        2.5,
        0
      ],
      [
        -1.6,
        1.05,
        2.5,
        0.9
      ],
      [
        -0.6,
        1.05,
        2.5,
        1.6
      ],
      [
        0,
        1.05,
        2.5,
        2
      ],
      [
        0,
        1.05,
        2.5,
        1
      ],
      [
        0,
        1.05,
        2.5,
        0
      ],
      [
        0,
        1.05,
        2.5,
        1
      ],
      [
        0,
        1.05,
        2.5,
        2
      ],
      [
        0,
        0.9,
        2,
        0.5
      ],
      [
        0,
        0.45,
        0.9,
        -1.5
      ],
      [
        0,
        0.35,
        0.5,
        -2.85
      ],
      [
        0,
        0.35,
        0.5,
        -4.6
      ],
      [
        0,
        0.6,
        1.2,
        -4.6
      ],
      [
        0,
        0.9,
        2,
        -3
      ],
      [
        -1.3,
        1.05,
        2.5,
        -1
      ],
      [
        -2.62,
        1.05,
        2.5,
        0
      ]
    ],
    "stages": [
      {
        "name": "HBM3 → L2",
        "parts": [
          "gpu-hbm"
        ],
        "cap": {
          "eli5": "The memory towers dump their colors onto the big shared table (L2) — super close, super fast.",
          "fifteen": "3.35 TB/s from 5 HBM3 stacks floods the 50 MB L2 — the staging ground for all 132 SMs.",
          "pro": "HBM3 controllers push tiles into the partitioned 50 MB L2 at multi-TB/s. The L2 is a bandwidth filter, sized for streaming reuse.",
          "expert": "1024-bit/stack HBM3 at ~6.5 Gbps/pin; L2 slices on the XBAR absorb coalesced traffic. Kernels are tiled for L2 residency — it’s the last knob before HBM."
        }
      },
      {
        "name": "L2 → SM array",
        "parts": [
          "gpu-l2",
          "gpu-interposer"
        ],
        "cap": {
          "eli5": "The table hands each of the 132 teams its piece of the puzzle, all at once.",
          "fifteen": "The on-die crossbar broadcasts tiles to 132 SMs; each SM’s warps chew through them in lockstep.",
          "pro": "The XBAR fans tiles out to 8 GPCs. Tensor Cores demand operands at TB/s — the fabric, not the ALUs, is the design center.",
          "expert": "All-to-all SM/L2 crossbar on one die — the reason GH100 stays monolithic. Chiplet hops would starve the Tensor Cores; bandwidth is the product."
        }
      },
      {
        "name": "Tensor Cores compute",
        "parts": [
          "gpu-gpc"
        ],
        "cap": {
          "eli5": "The super-fast matrix helpers multiply huge grids of numbers — this is the AI magic.",
          "fifteen": "4th-gen Tensor Cores crunch FP8/FP16 matrix-multiply-accumulate, 4 per SM across 132 SMs.",
          "pro": "Transformer Engine: FP8 with per-tensor scaling and 4:2 structured sparsity — ~8× the matmul throughput of CUDA cores per mm².",
          "expert": "Systolic MMA datapaths; 4 warp schedulers per SM hide HBM latency via occupancy. Arithmetic intensity decides HBM- vs compute-bound — data never sits still."
        }
      },
      {
        "name": "L2 → HBM / NVLink",
        "parts": [
          "gpu-l2",
          "gpu-nvlink"
        ],
        "cap": {
          "eli5": "Answers go back to the towers — or zoom across golden bridges to a neighboring GPU.",
          "fifteen": "Results coalesce in L2 and write back to HBM — or cross NVLink at 900 GB/s to the next GPU splitting the model.",
          "pro": "Writeback through L2 to HBM; NVLink 4.0 carries activations and gradients to peers — 8 GPUs behave as one memory pool.",
          "expert": "NVSwitch all-reduce at fabric speed; NVLink exists so interconnect never bottlenecks before HBM does. The nuance: a streaming firehose — bandwidth is everything, data never rests."
        }
      }
    ]
  },
  "dpu": {
    "color": 8036568,
    "path": [
      [
        0.7,
        0.55,
        0.9,
        -4.6
      ],
      [
        0.7,
        0.55,
        0.9,
        -2.35
      ],
      [
        0.2,
        0.8,
        1.4,
        -1.6
      ],
      [
        -0.745,
        1,
        2,
        -0.78
      ],
      [
        0.37,
        1,
        2,
        -0.4
      ],
      [
        0.37,
        1,
        2,
        0
      ],
      [
        0.75,
        1,
        2,
        0
      ],
      [
        1.12,
        1,
        2,
        0
      ],
      [
        0.4,
        1,
        2,
        0
      ],
      [
        -0.37,
        1,
        2,
        0
      ],
      [
        0.4,
        1,
        2,
        -0.4
      ],
      [
        1.12,
        1,
        2,
        -0.78
      ],
      [
        1.12,
        0.8,
        1.4,
        0.6
      ],
      [
        1.12,
        0.55,
        0.9,
        2.2
      ],
      [
        1.12,
        0.55,
        0.9,
        4.6
      ],
      [
        0.7,
        0.55,
        0.9,
        4.6
      ],
      [
        0.7,
        0.55,
        0.9,
        -4.6
      ]
    ],
    "stages": [
      {
        "name": "QSFP → ConnectX pipeline",
        "parts": [
          "dpu-qsfp",
          "dpu-net"
        ],
        "cap": {
          "eli5": "A message zooms in through the cable socket into the super-fast mailroom.",
          "fifteen": "400 GbE frames enter the ConnectX-7 pipeline via QSFP112 — parsed and classified in hardware.",
          "pro": "PAM4 112G SerDes into the parser and match-action tables; fixed logic owns the packet from the first bit.",
          "expert": "112G PAM4 SerDes, hardware parser, flow tables — zero CPU involvement. The pipeline, not software, is the fast path."
        }
      },
      {
        "name": "Inline crypto + RegEx",
        "parts": [
          "dpu-crypto",
          "dpu-regex"
        ],
        "cap": {
          "eli5": "Mid-flight, the message gets unscrambled and spell-checked for sneaky patterns — without stopping.",
          "fifteen": "IPsec/TLS decrypted inline while the RegEx engine scans for threats — bump-in-the-wire at line rate.",
          "pro": "Inline AES-GCM at 400G; hardware NFA/DFA for DPI/IDS. The “AI cybersecurity” story is this block plus the A78s.",
          "expert": "Inline vs lookaside: data never leaves the pipeline — an order-of-magnitude latency and throughput win over CPU AES-NI at 400G."
        }
      },
      {
        "name": "DPA packet cores",
        "parts": [
          "dpu-dpa"
        ],
        "cap": {
          "eli5": "The mailroom helpers stamp, sort, and route each message — tiny jobs, insanely fast.",
          "fifteen": "16 hyperthreaded DPA cores handle virtio, congestion control, custom protocols — programmable, unlike the fixed blocks.",
          "pro": "Multithreaded VLIW-ish cores hide latency via thread count — classic network-processor design, exposed through DOCA.",
          "expert": "Thread-count latency hiding for I/O-bound code; the A78s handle only exceptions. Ideal control/data-plane split: fixed chores → fixed logic, variable chores → DPA."
        }
      },
      {
        "name": "PCIe DMA → host",
        "parts": [
          "dpu-pcie"
        ],
        "cap": {
          "eli5": "The finished message slides into the computer’s memory all by itself — the big CPU never lifts a finger.",
          "fifteen": "PCIe Gen5 DMA drops the packet into host memory. The host CPU never touches it — that’s the whole point.",
          "pro": "The embedded PCIe switch (root-complex capable) DMAs through descriptor rings into host DRAM — zero host-CPU cycles per packet.",
          "expert": "Host-bypass I/O inverts the server: infrastructure owns the bus, the host is a tenant. The nuance: the packet never touched DRAM or the host CPU — ~30% “infrastructure tax” reclaimed."
        }
      }
    ]
  }
};

export const FLOW_STEP_NAMES: string[] = [
  "Off-chip memory → die",
  "Into the cache / pipeline",
  "Compute",
  "Writeback · ship out"
];

export interface TourCamera {
  phi: number;
  rScale: number;
  cy: number;
  explode: number;
}

export interface TourChapter {
  title: string;
  partIds: string[];
  caption: Record<DepthLevel, string>;
  cam: TourCamera;
}

const CH = (
  title: string,
  partIds: string[],
  caption: Record<DepthLevel, string>,
  cam: TourCamera,
): TourChapter => ({ title, partIds, caption, cam });

const PKG = { phi: 1.02, rScale: 1.0, cy: 2.4, explode: 0.62 };
const CORE = { phi: 0.95, rScale: 0.58, cy: 1.4, explode: 0.9 };
const MEM = { phi: 1.1, rScale: 0.7, cy: 1.6, explode: 0.85 };
const IO = { phi: 0.75, rScale: 0.85, cy: 2.0, explode: 0.55 };
const PWR = { phi: 1.25, rScale: 1.0, cy: 0.9, explode: 0.3 };

const capOf = (pid: string): Record<DepthLevel, string> => {
  const p = PARTS[pid];
  return { eli5: p.eli5, fifteen: p.fifteen, pro: p.pro, expert: p.expert };
};

export const TOUR: Record<ChipId, TourChapter[]> = {
  cpu: [
    CH('The package', ['cpu-ihs', 'cpu-substrate', 'cpu-pads'], capOf('cpu-ihs'), PKG),
    CH('The cores', ['cpu-ccd'], FLOW.cpu.stages[2].cap, CORE),
    CH('Memory in', ['cpu-iod'], FLOW.cpu.stages[0].cap, MEM),
    CH('The interconnect', ['cpu-iod'], FLOW.cpu.stages[1].cap, IO),
    CH('Power delivery', ['cpu-substrate', 'cpu-pads'], capOf('cpu-substrate'), PWR),
  ],
  gpu: [
    CH('The package', ['gpu-lid', 'gpu-pcb', 'gpu-pads'], capOf('gpu-lid'), PKG),
    CH('The SM array', ['gpu-gpc'], FLOW.gpu.stages[2].cap, CORE),
    CH('Memory in', ['gpu-hbm', 'gpu-l2'], FLOW.gpu.stages[0].cap, MEM),
    CH('The interconnect', ['gpu-nvlink', 'gpu-interposer'], FLOW.gpu.stages[3].cap, IO),
    CH('Power delivery', ['gpu-pcb', 'gpu-pads'], capOf('gpu-pcb'), PWR),
  ],
  dpu: [
    CH('The package', ['dpu-hs', 'dpu-card', 'dpu-bga'], capOf('dpu-hs'), PKG),
    CH('The cores', ['dpu-cores', 'dpu-dpa'], capOf('dpu-cores'), CORE),
    CH('Memory', ['dpu-dram', 'dpu-cache'], capOf('dpu-dram'), MEM),
    CH('The network path', ['dpu-net', 'dpu-qsfp'], FLOW.dpu.stages[0].cap, IO),
    CH('Power delivery', ['dpu-card', 'dpu-bga'], capOf('dpu-card'), PWR),
  ],
};
