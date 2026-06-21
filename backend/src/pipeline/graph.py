from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END

from src.pipeline.state import ResumeGraphState
from src.pipeline.nodes import (
    job_analysis_node,
    summary_skills_node,
    experience_node,
    project_node,
    assembly_node,
    render_node,
    save_artifacts_node,
)


# ── Node Wrappers ─────────────────────────────────────────────────────────────

async def wrap_job_analysis(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await job_analysis_node(state, db, gen_id)


async def wrap_summary_skills(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await summary_skills_node(state, db, gen_id)


async def wrap_experience(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await experience_node(state, db, gen_id)


async def wrap_project(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await project_node(state, db, gen_id)


async def wrap_assembly(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await assembly_node(state, db, gen_id)


async def wrap_render(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await render_node(state, db, gen_id)


async def wrap_save_artifacts(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await save_artifacts_node(state, db, gen_id)


# ── Graph Builder ─────────────────────────────────────────────────────────────

def compile_graph():
    builder = StateGraph(ResumeGraphState)

    builder.add_node("job_analysis", wrap_job_analysis)
    builder.add_node("summary_skills", wrap_summary_skills)
    builder.add_node("experience", wrap_experience)
    builder.add_node("project", wrap_project)
    builder.add_node("assembly", wrap_assembly)
    builder.add_node("render", wrap_render)
    builder.add_node("save_artifacts", wrap_save_artifacts)

    # Define flow edges
    builder.add_edge(START, "job_analysis")

    # Parallel fan-out
    builder.add_edge("job_analysis", "summary_skills")
    builder.add_edge("job_analysis", "experience")
    builder.add_edge("job_analysis", "project")

    # Fan-in
    builder.add_edge("summary_skills", "assembly")
    builder.add_edge("experience", "assembly")
    builder.add_edge("project", "assembly")

    builder.add_edge("assembly", "render")
    builder.add_edge("render", "save_artifacts")
    builder.add_edge("save_artifacts", END)

    return builder.compile()
