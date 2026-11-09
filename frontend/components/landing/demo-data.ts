/**
 * Content for the landing-page live résumé. Everything here is a fictional
 * demo profile. `[[double brackets]]` mark job keywords, which the sheet
 * underlines.
 */

export interface SkillRow {
  label: string
  items: string
}

export interface ResumeVariant {
  role: string
  skills: SkillRow[]
  experience: [string, string]
  /** Project index in PROJECT_POOL -> its two bullets. */
  projects: Record<number, [string, string]>
}

export interface DemoJob extends ResumeVariant {
  id: string
  chip: string
  file: string
  posting: string
}

export const PERSON = {
  name: "Tara Nair",
  email: "tara.nair@example.com",
  site: "example.com/tara",
  degree: "B.Tech in Computer Science",
  school: "Lakehurst University",
  years: "2023 – 2027",
  company: "Lattice Harbor",
  title: "Software Engineering Intern",
  dates: "May – Jul 2026",
}

export const PROJECT_POOL = [
  { name: "PaperTrail", tag: "RAG search over arXiv" },
  { name: "nanoLM", tag: "Transformer from scratch" },
  { name: "QueueKit", tag: "Job queue in Go" },
  { name: "CampusEats", tag: "Food-ordering platform" },
]

/** The untailored profile, as the pipeline first sees it. */
export const RAW: ResumeVariant = {
  role: "Computer Science Student",
  skills: [
    { label: "Languages", items: "Python, Go, TypeScript, SQL" },
    { label: "Tools", items: "PyTorch, FastAPI, Docker, Redis" },
    { label: "Other", items: "Git, Linux" },
  ],
  experience: [
    "Worked on backend services and helped the team with internal tools.",
    "Fixed bugs and wrote tests for different features.",
  ],
  projects: {},
}

export const JOBS: DemoJob[] = [
  {
    id: "llm",
    chip: "LLM Engineer",
    file: "tara_nair_llm_engineer.pdf",
    posting:
      "We are hiring an LLM engineer to build [[RAG]] systems and [[evals]]. You know [[PyTorch]] and [[FastAPI]], and you care about [[latency]].",
    role: "LLM Engineer",
    skills: [
      { label: "LLMs", items: "RAG, LangGraph, evals, vLLM" },
      { label: "ML", items: "PyTorch, transformers, quantization" },
      { label: "Backend", items: "FastAPI, PostgreSQL, Docker" },
    ],
    experience: [
      "Shipped an [[LLM]] support-triage service in [[FastAPI]], routing 8K tickets a week with [[structured outputs]].",
      "Built an [[eval harness]] of 400 golden cases that caught 3 prompt regressions before release.",
    ],
    projects: {
      0: [
        "Built [[RAG]] over 40K arXiv papers with [[pgvector]] and hybrid retrieval, reaching 0.81 nDCG@10.",
        "Cut p95 answer [[latency]] by 42% with [[reranking]] and response caching.",
      ],
      1: [
        "Trained a 30M-parameter [[transformer]] in [[PyTorch]], matching GPT-2-small loss on TinyStories.",
        "Added a KV cache and [[quantization]] for 3.2x faster inference.",
      ],
    },
  },
  {
    id: "backend",
    chip: "Backend Intern",
    file: "tara_nair_backend_intern.pdf",
    posting:
      "Backend intern to build [[REST APIs]] in [[FastAPI]] or [[Go]]. Experience with [[PostgreSQL]], [[Redis]] and [[Docker]] is a plus.",
    role: "Backend Engineer",
    skills: [
      { label: "Backend", items: "FastAPI, Go, REST APIs, PostgreSQL" },
      { label: "Infra", items: "Docker, AWS, Redis, CI" },
      { label: "ML", items: "PyTorch, RAG" },
    ],
    experience: [
      "Built [[FastAPI]] services on [[PostgreSQL]] handling 8K tickets a week at 99.9% uptime.",
      "Added [[CI]] suites covering 400 cases, taking release regressions to zero within a quarter.",
    ],
    projects: {
      2: [
        "Wrote a [[Redis]]-backed job queue in [[Go]] processing 12K jobs a minute with at-least-once delivery.",
        "Added retries, dead-letter queues and [[Prometheus]] metrics.",
      ],
      3: [
        "Designed [[REST APIs]] and a [[PostgreSQL]] schema serving 1.2K students a day.",
        "Deployed on [[AWS]] with [[Docker]], holding p95 under 120 ms at the lunch peak.",
      ],
    },
  },
  {
    id: "research",
    chip: "ML Research",
    file: "tara_nair_ml_research.pdf",
    posting:
      "Research engineer to run [[ablations]] and [[evaluation]] on [[transformer]] models in [[PyTorch]], and to write up what you find.",
    role: "ML Research Engineer",
    skills: [
      { label: "Research", items: "ablations, evaluation, PyTorch" },
      { label: "Models", items: "transformers, attention, retrieval" },
      { label: "Tools", items: "Python, Weights & Biases, Linux" },
    ],
    experience: [
      "Ran [[ablations]] on LLM triage prompts across 400 labelled cases, lifting accuracy by 11 points.",
      "Built a reproducible [[evaluation]] pipeline in [[PyTorch]] with seeded runs and tracked configs.",
    ],
    projects: {
      0: [
        "Benchmarked dense against hybrid [[retrieval]] on 40K papers, reporting nDCG@10 across 5 seeds.",
        "Open-sourced the code and every [[experiment]] log.",
      ],
      1: [
        "Implemented a 30M-parameter [[transformer]] from scratch in [[PyTorch]] and reproduced TinyStories baselines.",
        "Studied [[attention]]-head pruning: 30% of heads removed for under 1% loss increase.",
      ],
    },
  },
]

export const STAGES = [
  { node: "job_analysis", caption: "Reads the job." },
  { node: "selection", caption: "Picks your best work." },
  { node: "write", caption: "Rewrites it in their words." },
  { node: "fit_layout", caption: "Fits one page." },
  { node: "render", caption: "Ships the PDF." },
]

export const LARP_MODES = [
  {
    id: "proper",
    label: "Proper",
    hint: "Only what's in your profile",
    invented: false,
    bullet:
      "Built a [[RAG]] chatbot over course notes with LangChain and [[pgvector]] for a class of 60.",
  },
  {
    id: "larp",
    label: "LARP",
    hint: "Reframes and fills small gaps",
    invented: false,
    bullet:
      "Built a [[RAG]] assistant over 12K documents with [[pgvector]], cutting answer [[latency]] 41% through hybrid retrieval and [[reranking]].",
  },
  {
    id: "super_larp",
    label: "Super LARP",
    hint: "Adds an invented hero project",
    invented: true,
    bullet:
      "Built a [[RAG]] assistant over 12K documents with [[pgvector]], cutting answer [[latency]] 41% through hybrid retrieval and [[reranking]].",
  },
]

export const INVENTED_PROJECT = {
  name: "AgentForge",
  tag: "Agent eval harness",
  bullet:
    "Orchestrated [[LangGraph]] agents to run 2K [[evals]] nightly, flagging regressions in under 6 minutes.",
}
