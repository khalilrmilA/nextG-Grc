"""
Framework YAML loader.
Loads compliance framework definitions from YAML files into the database.
Framework YAML files live in the /frameworks directory at the repo root.
"""
import yaml
import os
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import structlog

from app.models.framework import Framework, FrameworkControl, ControlRequirement, FrameworkStatus

logger = structlog.get_logger()

FRAMEWORKS_DIR = Path(__file__).parent.parent.parent.parent / "frameworks"


async def load_all_frameworks(db: AsyncSession) -> dict[str, int]:
    """
    Load all YAML framework files from the frameworks directory into the database.
    Returns a dict of {framework_short_name: controls_loaded}.
    Idempotent — will update existing frameworks.
    """
    results = {}
    yaml_files = list(FRAMEWORKS_DIR.rglob("*.yaml"))

    logger.info("Loading frameworks", count=len(yaml_files), directory=str(FRAMEWORKS_DIR))

    for yaml_path in yaml_files:
        try:
            count = await load_framework_from_file(db, yaml_path)
            results[yaml_path.stem] = count
        except Exception as e:
            logger.error("Failed to load framework", file=str(yaml_path), error=str(e))

    await db.commit()
    return results


async def load_framework_from_file(db: AsyncSession, yaml_path: Path) -> int:
    """Load a single framework YAML file. Returns the number of controls loaded."""
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    framework_data = data.get("framework", {})
    name = framework_data.get("name")
    short_name = framework_data.get("short_name")
    version = framework_data.get("version", "1.0")

    # Skip if required fields are missing
    if not name or not short_name:
        logger.warning("Skipping framework — missing required fields", file=str(yaml_path), name=name, short_name=short_name)
        return 0

    # Check if framework already exists
    result = await db.execute(
        select(Framework).where(
            Framework.short_name == short_name,
            Framework.version == version,
        )
    )
    framework = result.scalar_one_or_none()

    if not framework:
        framework = Framework(
            name=framework_data.get("name", short_name),
            short_name=short_name,
            version=version,
            description=framework_data.get("description"),
            issuing_body=framework_data.get("issuing_body"),
            applicable_regions=framework_data.get("applicable_regions", ["global"]),
            applicable_industries=framework_data.get("applicable_industries", []),
            status=FrameworkStatus.ACTIVE,
            is_builtin=True,
        )
        db.add(framework)
        await db.flush()
        logger.info("Created framework", name=framework.name, version=version)
    else:
        logger.info("Updating framework", name=framework.name, version=version)

    # Load controls
    controls_data = data.get("controls", [])
    loaded = 0

    for i, ctrl_data in enumerate(controls_data):
        control_id = ctrl_data.get("id")

        # Check if control already exists
        ctrl_result = await db.execute(
            select(FrameworkControl).where(
                FrameworkControl.framework_id == framework.id,
                FrameworkControl.control_id == control_id,
            )
        )
        control = ctrl_result.scalar_one_or_none()

        if not control:
            control = FrameworkControl(
                framework_id=framework.id,
                control_id=control_id,
                title=ctrl_data.get("title", ""),
                description=ctrl_data.get("description"),
                guidance=ctrl_data.get("guidance"),
                category=ctrl_data.get("category"),
                sort_order=i,
                mapped_controls=ctrl_data.get("mapped_controls", []),
                tags=ctrl_data.get("tags", []),
                is_mandatory=ctrl_data.get("mandatory", False),
            )
            db.add(control)
            await db.flush()
        else:
            control.title = ctrl_data.get("title", control.title)
            control.description = ctrl_data.get("description", control.description)
            control.mapped_controls = ctrl_data.get("mapped_controls", control.mapped_controls)
            control.is_mandatory = ctrl_data.get("mandatory", control.is_mandatory)

        # Load requirements
        for req_data in ctrl_data.get("requirements", []):
            req_result = await db.execute(
                select(ControlRequirement).where(
                    ControlRequirement.control_id == control.id,
                    ControlRequirement.requirement_text == req_data.get("text", ""),
                )
            )
            if not req_result.scalar_one_or_none():
                req = ControlRequirement(
                    control_id=control.id,
                    requirement_text=req_data.get("text", ""),
                    requirement_level=req_data.get("level", "must"),
                )
                db.add(req)

        loaded += 1

    logger.info("Loaded controls", framework=short_name, count=loaded)
    return loaded
