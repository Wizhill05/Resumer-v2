from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db
from src.models.profile import Profile, UserEducation, UserExperience, UserProject, UserExtracurricular
from src.models.user import User
from src.schemas.profile import (
    EducationCreate,
    EducationOut,
    EducationUpdate,
    ExperienceCreate,
    ExperienceOut,
    ExperienceUpdate,
    ProfileOut,
    ProfileUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ExtracurricularCreate,
    ExtracurricularOut,
    ExtracurricularUpdate,
)

router = APIRouter(prefix="/profile", tags=["profile"])


# ── Base Profile ──────────────────────────────────────────────────────────────

@router.get("", response_model=ProfileOut)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = Profile(user_id=current_user.id)
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return profile


@router.put("", response_model=ProfileOut)
async def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if not profile:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(profile, field, value)

    await db.commit()
    await db.refresh(profile)
    return profile


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserProject).where(UserProject.user_id == current_user.id).order_by(UserProject.sort_order)
    )
    return result.scalars().all()


@router.post("/projects", response_model=ProjectOut)
async def add_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = UserProject(user_id=current_user.id, **data.model_dump())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.put("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserProject).where(UserProject.id == project_id, UserProject.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(project, field, value)

    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserProject).where(UserProject.id == project_id, UserProject.user_id == current_user.id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    await db.commit()
    return {"ok": True}


# ── Experiences ───────────────────────────────────────────────────────────────

@router.get("/experiences", response_model=list[ExperienceOut])
async def list_experiences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserExperience).where(UserExperience.user_id == current_user.id).order_by(UserExperience.sort_order)
    )
    return result.scalars().all()


@router.post("/experiences", response_model=ExperienceOut)
async def add_experience(
    data: ExperienceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    exp = UserExperience(user_id=current_user.id, **data.model_dump())
    db.add(exp)
    await db.commit()
    await db.refresh(exp)
    return exp


@router.put("/experiences/{exp_id}", response_model=ExperienceOut)
async def update_experience(
    exp_id: str,
    data: ExperienceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserExperience).where(UserExperience.id == exp_id, UserExperience.user_id == current_user.id)
    )
    exp = result.scalar_one_or_none()
    if not exp:
        raise HTTPException(status_code=404, detail="Experience not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(exp, field, value)

    await db.commit()
    await db.refresh(exp)
    return exp


@router.delete("/experiences/{exp_id}")
async def delete_experience(
    exp_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserExperience).where(UserExperience.id == exp_id, UserExperience.user_id == current_user.id)
    )
    exp = result.scalar_one_or_none()
    if not exp:
        raise HTTPException(status_code=404, detail="Experience not found")

    await db.delete(exp)
    await db.commit()
    return {"ok": True}


# ── Education ─────────────────────────────────────────────────────────────────

@router.get("/education", response_model=list[EducationOut])
async def list_education(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserEducation).where(UserEducation.user_id == current_user.id).order_by(UserEducation.sort_order)
    )
    return result.scalars().all()


@router.post("/education", response_model=EducationOut)
async def add_education(
    data: EducationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    edu = UserEducation(user_id=current_user.id, **data.model_dump())
    db.add(edu)
    await db.commit()
    await db.refresh(edu)
    return edu


@router.put("/education/{edu_id}", response_model=EducationOut)
async def update_education(
    edu_id: str,
    data: EducationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserEducation).where(UserEducation.id == edu_id, UserEducation.user_id == current_user.id)
    )
    edu = result.scalar_one_or_none()
    if not edu:
        raise HTTPException(status_code=404, detail="Education not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(edu, field, value)

    await db.commit()
    await db.refresh(edu)
    return edu


@router.delete("/education/{edu_id}")
async def delete_education(
    edu_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserEducation).where(UserEducation.id == edu_id, UserEducation.user_id == current_user.id)
    )
    edu = result.scalar_one_or_none()
    if not edu:
        raise HTTPException(status_code=404, detail="Education not found")

    await db.delete(edu)
    await db.commit()
    return {"ok": True}


# ── Extracurriculars ──────────────────────────────────────────────────────────

@router.get("/extracurriculars", response_model=list[ExtracurricularOut])
async def list_extracurriculars(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserExtracurricular).where(UserExtracurricular.user_id == current_user.id).order_by(UserExtracurricular.sort_order)
    )
    return result.scalars().all()


@router.post("/extracurriculars", response_model=ExtracurricularOut)
async def add_extracurricular(
    data: ExtracurricularCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    extra = UserExtracurricular(user_id=current_user.id, **data.model_dump())
    db.add(extra)
    await db.commit()
    await db.refresh(extra)
    return extra


@router.put("/extracurriculars/{extra_id}", response_model=ExtracurricularOut)
async def update_extracurricular(
    extra_id: str,
    data: ExtracurricularUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserExtracurricular).where(UserExtracurricular.id == extra_id, UserExtracurricular.user_id == current_user.id)
    )
    extra = result.scalar_one_or_none()
    if not extra:
        raise HTTPException(status_code=404, detail="Extracurricular activity not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(extra, field, value)

    await db.commit()
    await db.refresh(extra)
    return extra


@router.delete("/extracurriculars/{extra_id}")
async def delete_extracurricular(
    extra_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi import HTTPException
    result = await db.execute(
        select(UserExtracurricular).where(UserExtracurricular.id == extra_id, UserExtracurricular.user_id == current_user.id)
    )
    extra = result.scalar_one_or_none()
    if not extra:
        raise HTTPException(status_code=404, detail="Extracurricular activity not found")

    await db.delete(extra)
    await db.commit()
    return {"ok": True}

