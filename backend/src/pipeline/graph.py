from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END

from src.pipeline.state import ResumeGraphState
from src.pipeline.nodes import (
    job_analysis_node,
    selection_node,
    summary_skills_node,
    experience_node,
    project_node,
    assembly_node,
    render_node,
    orphan_repair_node,
    content_reduction_node,
    save_artifacts_node,
)


# ── Node Wrappers ─────────────────────────────────────────────────────────────

async def wrap_job_analysis(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await job_analysis_node(state, db, gen_id)


async def wrap_selection(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await selection_node(state, db, gen_id)


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


async def wrap_orphan_repair(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await orphan_repair_node(state, db, gen_id)


async def wrap_content_reduction(state: ResumeGraphState, config: RunnableConfig):
    db = config["configurable"]["db"]
    gen_id = config["configurable"]["gen_id"]
    return await content_reduction_node(state, db, gen_id)


# ── Graph Builder ─────────────────────────────────────────────────────────────

def compile_graph():
    builder = StateGraph(ResumeGraphState)

    builder.add_node("job_analysis", wrap_job_analysis)
    builder.add_node("selection", wrap_selection)
    builder.add_node("summary_skills", wrap_summary_skills)
    builder.add_node("experience", wrap_experience)
    builder.add_node("project", wrap_project)
    builder.add_node("assembly", wrap_assembly)
    builder.add_node("render", wrap_render)
    builder.add_node("orphan_repair", wrap_orphan_repair)
    builder.add_node("content_reduction", wrap_content_reduction)
    builder.add_node("save_artifacts", wrap_save_artifacts)

    # Define flow edges
    builder.add_edge(START, "job_analysis")
    builder.add_edge("job_analysis", "selection")

    # Parallel fan-out
    builder.add_edge("selection", "summary_skills")
    builder.add_edge("selection", "experience")
    builder.add_edge("selection", "project")

    # Fan-in
    builder.add_edge("summary_skills", "assembly")
    builder.add_edge("experience", "assembly")
    builder.add_edge("project", "assembly")

    builder.add_edge("assembly", "render")

    # Conditional routing after render: overflow > orphans > done
    def route_after_render(state: ResumeGraphState) -> str:
        target_pages = state.get("template_manifest", {}).get("target_pages", 1)
        page_count = state.get("page_count", 1)

        # Priority 1: page overflow — reduce content
        if page_count > target_pages:
            if state.get("content_reduction_step", 0) < 2:
                return "content_reduction"
            # Exhausted reductions, save with whatever we have
            return "save_artifacts"

        # Priority 2: orphan line-wrap fixes
        if state.get("orphans") and state.get("repair_attempts", 0) < 2:
            return "orphan_repair"

        return "save_artifacts"

    builder.add_conditional_edges("render", route_after_render)
    builder.add_edge("orphan_repair", "assembly")
    builder.add_edge("content_reduction", "assembly")
    builder.add_edge("save_artifacts", END)

    return builder.compile()
